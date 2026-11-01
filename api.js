/*
 * Flexiple Hiring Hub: mock API.
 *
 * In-memory data with a 300-500 ms delay on every call. The UI talks only to
 * window.HubAPI, so a real backend can replace this file one function at a
 * time without touching the screens. Every function returns a Promise of
 * plain JSON (copies, never live references).
 */
(function (global) {
  'use strict';

  const DAY = 24 * 60 * 60 * 1000;
  const WEEK = 7 * DAY;
  const YEAR = 365 * DAY;
  const CHANNELS = ['inapp', 'email', 'whatsapp'];
  const MAX_PER_WEEK = 2;

  const wait = () => new Promise(r => setTimeout(r, 300 + Math.random() * 200));
  const clone = x => JSON.parse(JSON.stringify(x));
  const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
  const daysSince = t => Math.max(0, Math.round((startOfDay(Date.now()) - startOfDay(t)) / DAY));
  const daysUntil = t => Math.round((startOfDay(t) - startOfDay(Date.now())) / DAY);
  const fmt = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  const fmtLong = t => new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

  const EVENT_LABEL = {
    stage_moved: 'Moved to next round',
    check_in: 'No update for a while',
    role_paused: 'Role paused',
    not_selected: 'Not selected',
    offer_made: 'Offer made',
    offer_accepted: 'Offer accepted',
    joined: 'Joined',
  };
  const OUTCOME_EVENTS = ['role_paused', 'not_selected', 'joined'];

  let db;
  let seq = 0;
  const newId = p => `${p}${++seq}`;

  const roleOf = id => db.roles.find(r => r.id === id);
  const companyOf = id => db.companies.find(c => c.id === id);
  const candOf = id => db.candidates.find(c => c.id === id);
  const offerOf = cid => db.offers.find(o => o.candidateId === cid);
  const inCompany = (c, companyId) => !companyId || roleOf(c.roleId).companyId === companyId;

  /* ---------- derived values ---------- */

  function nextUpdate(c) {
    if (c.status !== 'active' || !c.nextUpdateBy) return null;
    const today = startOfDay(Date.now());
    if (startOfDay(c.nextUpdateBy) >= today) return { from: c.nextUpdateBy, to: null, slipped: false };
    // The promised date passed with no update: show a range that keeps moving forward.
    return { from: today + DAY, to: today + 3 * DAY, slipped: true, original: c.nextUpdateBy };
  }

  function validTests(c) {
    const cutoff = Date.now() - YEAR;
    return c.tests
      .filter(t => t.passedAt > cutoff)
      .map(t => ({ ...t, validUntil: t.passedAt + YEAR }))
      .sort((a, b) => b.passedAt - a.passedAt);
  }

  // Process signals only. No profile data, no guesses about the person.
  function riskOf(o) {
    const signals = [];
    let score = 0;
    const sinceReply = daysSince(o.lastReplyAt);
    if (sinceReply >= 21) { score += 2; signals.push(`No reply for ${sinceReply} days`); }
    else if (sinceReply >= 10) { score += 1; signals.push(`No reply for ${sinceReply} days`); }
    if (o.joiningDate > o.originalJoiningDate) {
      score += 1;
      signals.push(`Joining date pushed back ${Math.round((o.joiningDate - o.originalJoiningDate) / DAY)} days`);
    }
    if (o.missedCheckins > 0) {
      score += o.missedCheckins;
      signals.push(`${o.missedCheckins} missed check-in${o.missedCheckins === 1 ? '' : 's'}`);
    }
    const level = score >= 2 ? 'High' : score === 1 ? 'Medium' : 'Low';
    return { level, score, signals };
  }

  function guardOf(d) {
    const c = candOf(d.candidateId);
    const since = Date.now() - WEEK;
    const recent = c.messages.filter(m => m.roleId === d.roleId && m.at > since).sort((a, b) => a.at - b.at);
    if (recent.length < MAX_PER_WEEK) return { blocked: false, sentThisWeek: recent.length };
    const lastTwo = recent.slice(-MAX_PER_WEEK);
    const first = c.name.split(' ')[0];
    return {
      blocked: true,
      sentThisWeek: recent.length,
      reason: `${first} already got ${MAX_PER_WEEK} messages about this role in the last 7 days ` +
        `(${fmt(lastTwo[0].at)} and ${fmt(lastTwo[1].at)}). The limit is ${MAX_PER_WEEK} per role per week, ` +
        `so this can go out from ${fmt(lastTwo[0].at + WEEK)}.`,
    };
  }

  /* ---------- message templates: pipeline facts only ---------- */

  function compose(event, c, extra = {}) {
    const role = roleOf(c.roleId);
    const co = companyOf(role.companyId);
    const first = c.name.split(' ')[0];
    const n = role.rounds.length;
    const at = i => `${role.rounds[i]} (round ${i + 1} of ${n})`;
    switch (event) {
      case 'stage_moved':
        return `Hi ${first}, you've cleared ${role.rounds[c.round - 1]} for the ${role.title} role at ${co.name}. ` +
          `Your next step is ${at(c.round)}. We'll update you by ${fmt(c.nextUpdateBy)}.`;
      case 'check_in': {
        const nu = nextUpdate(c);
        const when = nu.to ? `between ${fmt(nu.from)} and ${fmt(nu.to)}` : `by ${fmt(nu.from)}`;
        return `Hi ${first}, no change yet on your ${role.title} application with ${co.name}. ` +
          `You're at ${at(c.round)}, and we expect the next update ${when}.`;
      }
      case 'role_paused':
        return `Hi ${first}, ${co.name} has paused hiring for the ${role.title} role, so your application is on hold. ` +
          `You reached ${at(c.round)}. We'll message you if the role reopens.`;
      case 'not_selected': {
        const tests = validTests(c);
        const keep = tests.length ? ` Your passed tests stay valid until ${fmtLong(tests[0].validUntil)} for other Flexiple roles.` : '';
        return `Hi ${first}, ${co.name} has decided not to move forward with your application for the ${role.title} role ` +
          `after ${role.rounds[c.round]}.${keep}`;
      }
      case 'offer_made':
        return `Hi ${first}, ${co.name} has made you an offer for the ${role.title} role. You cleared all ${n} rounds.`;
      case 'offer_accepted':
        return `Hi ${first}, your offer from ${co.name} for the ${role.title} role is confirmed. ` +
          `Your joining date is ${fmtLong(extra.joiningDate)}.`;
      case 'joined':
        return `Hi ${first}, welcome to ${co.name}. Today is your Day 1 as ${role.title}.`;
      default:
        throw new Error(`Unknown event: ${event}`);
    }
  }

  function createDraft(c, event, createdAt = Date.now()) {
    const d = {
      id: newId('d'),
      candidateId: c.id,
      roleId: c.roleId,
      event,
      text: compose(event, c),
      channels: CHANNELS.slice(),
      status: 'pending',
      createdAt,
      sentAt: null,
    };
    db.drafts.push(d);
    return d;
  }

  /* ---------- seed data ---------- */

  function seed() {
    const now = Date.now();
    const at = n => now + n * DAY; // n days from now; negative means in the past
    seq = 0;

    const companies = [
      { id: 'c1', name: 'Northwind Analytics', blurb: 'B2B SaaS · New York', hrLead: 'Rachel Kim', hrTitle: 'Head of People' },
      { id: 'c2', name: 'Lumen Health', blurb: 'Health tech · Boston', hrLead: 'David Osei', hrTitle: 'HR Lead' },
      { id: 'c3', name: 'Brightpath Logistics', blurb: 'Logistics software · Austin', hrLead: 'Maria Lopez', hrTitle: 'Talent Lead' },
    ];
    const recruiter = { name: 'Priya Raman', title: 'Flexiple recruiter' };

    const roles = [
      { id: 'r1', companyId: 'c1', title: 'Senior Backend Engineer (Node.js)', test: 'Node.js coding test', noticeDays: 60,
        rounds: ['Profile review', 'Flexiple coding test', 'Recruiter call', 'Technical interview 1', 'System design', 'Hiring manager', 'Founder chat'] },
      { id: 'r2', companyId: 'c1', title: 'Frontend Engineer (React)', test: 'React coding test', noticeDays: 90,
        rounds: ['Profile review', 'Flexiple coding test', 'Take-home task', 'Technical interview', 'Hiring manager'] },
      { id: 'r3', companyId: 'c2', title: 'Data Engineer (Python, Spark)', test: 'Python and SQL test', noticeDays: 60,
        rounds: ['Profile review', 'Flexiple coding test', 'SQL round', 'Pipeline design', 'Team interview', 'Hiring manager'] },
      { id: 'r4', companyId: 'c2', title: 'DevOps Engineer (AWS)', test: 'Cloud and Linux test', noticeDays: 90,
        rounds: ['Profile review', 'Flexiple coding test', 'Infra deep dive', 'Team interview', 'Hiring manager'] },
      { id: 'r5', companyId: 'c3', title: 'Full-stack Engineer (Django, React)', test: 'Python and React test', noticeDays: 60,
        rounds: ['Profile review', 'Flexiple coding test', 'Pair programming', 'System design', 'Team interview', 'CTO chat'] },
      { id: 'r6', companyId: 'c3', title: 'Android Engineer (Kotlin)', test: 'Kotlin coding test', noticeDays: 90,
        rounds: ['Profile review', 'Flexiple coding test', 'Technical interview', 'Hiring manager', 'Founder chat'] },
    ].map(r => ({ ...r, status: 'open', pausedAt: null }));

    // [id, name, city, roleId, round, status, lastUpdateAgo, lastMovedAgo, nextUpdateIn, outcomeSent]
    const rows = [
      ['k1', 'Arjun Mehta', 'Bengaluru', 'r1', 3, 'active', 6, 6, 1, false],
      ['k2', 'Sneha Iyer', 'Pune', 'r1', 5, 'active', 9, 12, -2, false],
      ['k3', 'Vikram Nair', 'Kochi', 'r1', 6, 'accepted', 9, 26, null, true],
      ['k4', 'Pooja Reddy', 'Hyderabad', 'r1', 1, 'active', 2, 2, 4, false],
      ['k5', 'Aditya Kulkarni', 'Mumbai', 'r1', 4, 'rejected', 15, 15, null, true],
      ['k6', 'Meera Pillai', 'Chennai', 'r2', 4, 'accepted', 2, 30, null, true],
      ['k7', 'Ishaan Gupta', 'Delhi', 'r2', 4, 'active', 11, 11, -4, false],
      ['k8', 'Nikhil Joshi', 'Jaipur', 'r2', 2, 'active', 2, 4, 3, false],
      ['k9', 'Ananya Sharma', 'Gurugram', 'r3', 5, 'accepted', 12, 45, null, true],
      ['k10', 'Farhan Qureshi', 'Lucknow', 'r3', 4, 'active', 8, 8, -1, false],
      ['k11', 'Divya Menon', 'Thiruvananthapuram', 'r3', 2, 'active', 3, 3, 4, false],
      ['k12', 'Rahul Verma', 'Indore', 'r3', 2, 'rejected', 20, 20, null, false],
      ['k13', 'Siddharth Rao', 'Mangaluru', 'r4', 3, 'active', 13, 13, -6, false],
      ['k14', 'Kavya Nair', 'Bengaluru', 'r4', 1, 'active', 1, 1, 5, false],
      ['k15', 'Manish Tiwari', 'Bhopal', 'r4', 4, 'joined', 10, 70, null, true],
      ['k16', 'Tanvi Deshpande', 'Nagpur', 'r5', 5, 'accepted', 4, 20, null, true],
      ['k17', 'Harsh Agarwal', 'Ahmedabad', 'r5', 4, 'active', 7, 7, 0, false],
      ['k18', 'Neha Bhatt', 'Vadodara', 'r5', 2, 'active', 5, 5, 2, false],
      ['k19', 'Aman Singh', 'Chandigarh', 'r6', 3, 'active', 10, 10, -3, false],
      ['k20', 'Shreya Banerjee', 'Kolkata', 'r6', 1, 'rejected', 18, 18, null, false],
    ];

    // Accepted offers. Joining and reply dates drive the risk level.
    const offerRows = [
      { candidateId: 'k3', joinIn: 34, originalJoinIn: 27, lastContactAgo: 9, lastReplyAgo: 16, missedCheckins: 1, runnerUpId: 'k2' },
      { candidateId: 'k6', joinIn: 52, originalJoinIn: 52, lastContactAgo: 2, lastReplyAgo: 2, missedCheckins: 0, runnerUpId: 'k7' },
      { candidateId: 'k9', joinIn: 20, originalJoinIn: 20, lastContactAgo: 5, lastReplyAgo: 12, missedCheckins: 0, runnerUpId: 'k10' },
      { candidateId: 'k16', joinIn: 41, originalJoinIn: 34, lastContactAgo: 4, lastReplyAgo: 4, missedCheckins: 0, runnerUpId: 'k17' },
    ];

    db = { companies, recruiter, roles, candidates: [], offers: [], drafts: [] };

    db.offers = offerRows.map(o => ({
      candidateId: o.candidateId,
      joiningDate: startOfDay(at(o.joinIn)),
      originalJoiningDate: startOfDay(at(o.originalJoinIn)),
      lastContactAt: at(-o.lastContactAgo),
      lastReplyAt: at(-o.lastReplyAgo),
      missedCheckins: o.missedCheckins,
      runnerUpId: o.runnerUpId,
    }));

    db.candidates = rows.map(([id, name, city, roleId, round, status, lastUpdateAgo, lastMovedAgo, nextUpdateIn, outcomeSent]) => {
      const role = roles.find(r => r.id === roleId);
      const c = {
        id, name, city, roleId, round, status, outcomeSent,
        lastUpdateAt: at(-lastUpdateAgo),
        lastMovedAt: at(-lastMovedAgo),
        nextUpdateBy: nextUpdateIn === null ? null : startOfDay(at(nextUpdateIn)),
        pausedAt: null,
        messages: [],
        tests: [],
      };
      db.candidates.push(c);

      // Message history: one update per round reached, then the outcome if one was sent.
      const hasOutcome = status !== 'active' && outcomeSent;
      const stageEnd = hasOutcome ? lastUpdateAgo + 6 : lastUpdateAgo;
      for (let i = 1; i <= round; i++) {
        const sentAt = at(-(stageEnd + (round - i) * 6));
        // The latest update promises the date the tracker shows now.
        const promised = i === round && c.nextUpdateBy ? c.nextUpdateBy : startOfDay(sentAt + 5 * DAY);
        const snapshot = { ...c, round: i, nextUpdateBy: promised };
        c.messages.push({ id: newId('m'), roleId, event: 'stage_moved', at: sentAt, channels: ['inapp', 'email'], text: compose('stage_moved', snapshot) });
      }
      if (hasOutcome) {
        const event = { accepted: 'offer_accepted', rejected: 'not_selected', joined: 'joined' }[status];
        const offer = db.offers.find(o => o.candidateId === id);
        c.messages.push({
          id: newId('m'), roleId, event, at: at(-lastUpdateAgo), channels: CHANNELS.slice(),
          text: compose(event, c, { joiningDate: offer && offer.originalJoiningDate }),
        });
      }

      // Saved tests: anyone past the coding test round passed it.
      if (round >= 2) {
        c.tests.push({ name: role.test, score: `${72 + ((id.length * 7 + round * 5) % 24)}/100`, passedAt: at(-(stageEnd + (round - 1) * 6)) });
      }
      return c;
    });

    const k1 = candOf('k1');
    k1.tests.push({ name: 'System design fundamentals', score: 'Pass', passedAt: at(-212) });
    k1.tests.push({ name: 'JavaScript basics', score: '81/100', passedAt: at(-420) }); // older than 12 months: hidden

    // Nikhil got a check-in 5 days ago, so a third message this week is blocked.
    const k8 = candOf('k8');
    const k8Snapshot = { ...k8, round: 1, nextUpdateBy: startOfDay(at(-1)) };
    k8.messages.push({ id: newId('m'), roleId: 'r2', event: 'check_in', at: at(-5), channels: ['inapp', 'whatsapp'],
      text: `Hi Nikhil, no change yet on your Frontend Engineer (React) application with Northwind Analytics. You're at Flexiple coding test (round 2 of 5), and we expect the next update by ${fmt(k8Snapshot.nextUpdateBy)}.` });

    db.candidates.forEach(c => {
      c.messages.sort((a, b) => a.at - b.at);
      // Every message sent in the last week went through a draft.
      c.messages.filter(m => m.at > now - WEEK).forEach(m => {
        db.drafts.push({ id: newId('d'), candidateId: c.id, roleId: m.roleId, event: m.event, text: m.text,
          channels: m.channels, status: 'sent', createdAt: m.at - 2 * 60 * 60 * 1000, sentAt: m.at });
      });
    });

    // Drafts waiting for approval.
    createDraft(candOf('k10'), 'check_in', at(-0.2));
    createDraft(k8, 'check_in', at(-0.1));
    const k17 = candOf('k17');
    createDraft(k17, 'check_in', at(-0.05));
  }

  /* ---------- views returned to the UI ---------- */

  function candidateView(c) {
    const role = roleOf(c.roleId);
    const co = companyOf(role.companyId);
    return {
      id: c.id, name: c.name, city: c.city, status: c.status, round: c.round,
      roleId: role.id, roleTitle: role.title, roleStatus: role.status,
      companyId: co.id, companyName: co.name,
      rounds: role.rounds.slice(), roundName: role.rounds[c.round],
      daysWaiting: daysSince(c.lastUpdateAt),
      daysSinceMove: daysSince(c.lastMovedAt),
      lastUpdateAt: c.lastUpdateAt,
      nextUpdate: nextUpdate(c),
      outcomeSent: c.outcomeSent,
      pendingDraft: db.drafts.some(d => d.candidateId === c.id && d.status === 'pending'),
    };
  }

  function roleView(r) {
    const co = companyOf(r.companyId);
    const cands = db.candidates.filter(c => c.roleId === r.id);
    const active = cands.filter(c => c.status === 'active');
    const perRound = r.rounds.map((_, i) => active.filter(c => c.round === i));
    return {
      ...clone(r),
      companyName: co.name,
      activeCount: active.length,
      offerCount: cands.filter(c => ['offer', 'accepted'].includes(c.status)).length,
      stageCounts: perRound.map(list => list.length),
      stageLongestWait: perRound.map(list => (list.length ? Math.max(...list.map(c => daysSince(c.lastMovedAt))) : null)),
      daysSinceMove: cands.length ? Math.min(...cands.map(c => daysSince(c.lastMovedAt))) : null,
    };
  }

  function draftView(d) {
    const c = candOf(d.candidateId);
    const role = roleOf(d.roleId);
    return {
      ...clone(d),
      eventLabel: d.event === 'check_in' ? `Check-in · last update ${daysSince(c.lastUpdateAt)} days ago` : EVENT_LABEL[d.event],
      candidateName: c.name,
      roleTitle: role.title,
      companyName: companyOf(role.companyId).name,
      guard: guardOf(d),
    };
  }

  function mustFind(item, what) {
    if (!item) throw new Error(`${what} not found`);
    return item;
  }

  /* ---------- public API ---------- */

  const api = {
    async getContext() {
      await wait();
      return clone({ companies: db.companies, recruiter: db.recruiter });
    },

    async getRoles(companyId) {
      await wait();
      return db.roles.filter(r => !companyId || r.companyId === companyId).map(roleView);
    },

    async getCandidates(filter = {}) {
      await wait();
      return db.candidates
        .filter(c => (!filter.roleId || c.roleId === filter.roleId) && inCompany(c, filter.companyId))
        .map(candidateView);
    },

    // What the candidate sees. Never includes risk.
    async getCandidate(id) {
      await wait();
      const c = mustFind(candOf(id), 'Candidate');
      const o = offerOf(id);
      return {
        ...candidateView(c),
        messages: clone(c.messages).sort((a, b) => b.at - a.at),
        tests: validTests(c),
        offer: o && c.status === 'accepted' ? { joiningDate: o.joiningDate, daysLeft: daysUntil(o.joiningDate) } : null,
      };
    },

    async getAlerts(minDays = 7) {
      await wait();
      return db.candidates
        .filter(c => c.status === 'active' && daysSince(c.lastUpdateAt) >= minDays)
        .map(candidateView)
        .sort((a, b) => b.daysWaiting - a.daysWaiting);
    },

    async getDrafts() {
      await wait();
      return db.drafts.filter(d => d.status === 'pending').sort((a, b) => b.createdAt - a.createdAt).map(draftView);
    },

    // For the client HR lead and the recruiter only.
    async getOffers(companyId) {
      await wait();
      return db.offers
        .filter(o => candOf(o.candidateId).status === 'accepted' && inCompany(candOf(o.candidateId), companyId))
        .map(o => {
          const c = candOf(o.candidateId);
          const runner = o.runnerUpId && candOf(o.runnerUpId);
          return {
            ...clone(o),
            candidateName: c.name,
            roleTitle: roleOf(c.roleId).title,
            noticeDays: roleOf(c.roleId).noticeDays,
            daysLeft: daysUntil(o.joiningDate),
            risk: riskOf(o),
            runnerUp: runner ? candidateView(runner) : null,
          };
        })
        .sort((a, b) => b.risk.score - a.risk.score || a.daysLeft - b.daysLeft);
    },

    async getMetrics(companyId) {
      await wait();
      const cands = db.candidates.filter(c => inCompany(c, companyId));
      const closed = cands.filter(c => ['rejected', 'paused', 'joined'].includes(c.status));
      const clear = closed.filter(c => c.outcomeSent).length;
      const risks = db.offers
        .filter(o => cands.includes(candOf(o.candidateId)) && candOf(o.candidateId).status === 'accepted')
        .map(riskOf);
      const weekAgo = Date.now() - WEEK;
      const drafts = db.drafts.filter(d => d.createdAt > weekAgo && cands.includes(candOf(d.candidateId)));
      return {
        noUpdate8: cands.filter(c => c.status === 'active' && daysSince(c.lastUpdateAt) >= 8).length,
        openCount: cands.filter(c => c.status === 'active').length,
        closed: closed.length,
        clear,
        clearPct: closed.length ? Math.round((clear / closed.length) * 100) : 100,
        offers: risks.length,
        atRisk: risks.filter(r => r.level !== 'Low').length,
        high: risks.filter(r => r.level === 'High').length,
        drafted: drafts.length,
        sent: drafts.filter(d => d.status === 'sent').length,
      };
    },

    // Moves an active candidate to the next round and drafts the update.
    async updateStage(candidateId) {
      await wait();
      const c = mustFind(candOf(candidateId), 'Candidate');
      const role = roleOf(c.roleId);
      if (c.status !== 'active') throw new Error(`${c.name} is not in process.`);
      if (c.round >= role.rounds.length - 1) throw new Error(`${c.name} is already in the last round.`);
      c.round += 1;
      c.lastMovedAt = Date.now();
      c.nextUpdateBy = startOfDay(Date.now() + 5 * DAY);
      db.drafts.filter(d => d.candidateId === c.id && d.status === 'pending' && d.event === 'check_in')
        .forEach(d => { d.status = 'discarded'; });
      const d = createDraft(c, 'stage_moved');
      return { candidate: candidateView(c), draft: draftView(d) };
    },

    async makeOffer(candidateId) {
      await wait();
      const c = mustFind(candOf(candidateId), 'Candidate');
      if (c.status !== 'active') throw new Error(`${c.name} is not in process.`);
      c.status = 'offer';
      c.lastMovedAt = Date.now();
      return { draft: draftView(createDraft(c, 'offer_made')) };
    },

    async markNotSelected(candidateId) {
      await wait();
      const c = mustFind(candOf(candidateId), 'Candidate');
      if (c.status !== 'active') throw new Error(`${c.name} is not in process.`);
      c.status = 'rejected';
      c.lastMovedAt = Date.now();
      return { draft: draftView(createDraft(c, 'not_selected')) };
    },

    // Puts every active candidate on hold and drafts an outcome for each.
    async pauseRole(roleId) {
      await wait();
      const role = mustFind(roleOf(roleId), 'Role');
      role.status = 'paused';
      role.pausedAt = Date.now();
      const affected = db.candidates.filter(c => c.roleId === roleId && c.status === 'active');
      affected.forEach(c => {
        c.status = 'paused';
        c.pausedAt = Date.now();
        db.drafts.filter(d => d.candidateId === c.id && d.status === 'pending').forEach(d => { d.status = 'discarded'; });
        createDraft(c, 'role_paused');
      });
      return { role: roleView(role), drafted: affected.length };
    },

    async draftMessage(candidateId, event = 'check_in') {
      await wait();
      const c = mustFind(candOf(candidateId), 'Candidate');
      if (event === 'check_in' && c.status !== 'active') throw new Error(`${c.name} is not in process.`);
      return draftView(createDraft(c, event));
    },

    async editDraft(draftId, { text, channels } = {}) {
      await wait();
      const d = mustFind(db.drafts.find(x => x.id === draftId), 'Draft');
      if (typeof text === 'string' && text.trim()) d.text = text.trim();
      if (Array.isArray(channels) && channels.length) d.channels = channels.filter(ch => CHANNELS.includes(ch));
      return draftView(d);
    },

    // The only way a message reaches a candidate.
    async approveMessage(draftId, overrides = {}) {
      await wait();
      const d = mustFind(db.drafts.find(x => x.id === draftId), 'Draft');
      if (d.status !== 'pending') throw new Error('This draft was already handled.');
      if (typeof overrides.text === 'string' && overrides.text.trim()) d.text = overrides.text.trim();
      if (Array.isArray(overrides.channels) && overrides.channels.length) d.channels = overrides.channels;
      const g = guardOf(d);
      if (g.blocked) throw new Error(g.reason);
      const c = candOf(d.candidateId);
      const sentAt = Date.now();
      c.messages.push({ id: newId('m'), roleId: d.roleId, event: d.event, at: sentAt, channels: d.channels.slice(), text: d.text });
      c.lastUpdateAt = sentAt;
      if (OUTCOME_EVENTS.includes(d.event)) c.outcomeSent = true;
      d.status = 'sent';
      d.sentAt = sentAt;
      return draftView(d);
    },

    async discardDraft(draftId) {
      await wait();
      const d = mustFind(db.drafts.find(x => x.id === draftId), 'Draft');
      d.status = 'discarded';
      return { ok: true };
    },

    async markMissedCheckin(candidateId) {
      await wait();
      const o = mustFind(offerOf(candidateId), 'Offer');
      o.missedCheckins += 1;
      return { risk: riskOf(o) };
    },

    async resetDemo() {
      await wait();
      seed();
      return { ok: true };
    },
  };

  seed();
  global.HubAPI = api;
})(window);
