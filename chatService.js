/**
 * Andy chatService.js
 * Handles all Claude API communication, context building, response parsing,
 * and data-action execution. Exported to window.CS.
 */
(function () {
  'use strict';

  // ─── LLM helper — uses SenseiAI (OpenAI-compatible) if endpoint_url is set,
  //     otherwise falls back to Claude (Anthropic API).
  async function callLLM(systemPrompt, userMessage, maxTokens = 512, history = []) {
    const apiKey      = window.storage.get('settings:api_key') || '';
    const endpointUrl = window.storage.get('settings:endpoint_url') || '';

    if (endpointUrl) {
      // ── SenseiAI path ────────────────────────────────────────────────────────
      const model = window.storage.get('settings:model') || 'senseiAI';
      const messages = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: userMessage },
      ];
      let res;
      try {
        res = await fetch(`${endpointUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
          },
          body: JSON.stringify({ model, messages, max_tokens: maxTokens }),
        });
      } catch (_) {
        throw new Error('SenseiAI server is not running — open SenseiAI/start.bat first.');
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error?.message || `SenseiAI error: HTTP ${res.status}`);
      }
      const body = await res.json();
      return body.choices?.[0]?.message?.content?.trim() ?? '';
    }

    // ── Claude fallback path ──────────────────────────────────────────────────
    const messages = [
      ...history,
      { role: 'user', content: userMessage },
    ];
    let res;
    try {
      res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type':                              'application/json',
          'x-api-key':                                 apiKey,
          'anthropic-version':                         '2023-06-01',
          'anthropic-dangerous-direct-browser-calls':  'true',
        },
        body: JSON.stringify({
          model:      'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system:     systemPrompt,
          messages,
        }),
      });
    } catch (_) {
      throw new Error('Cannot reach Claude API — check your internet connection.');
    }
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Claude error: HTTP ${res.status}`);
    }
    const body = await res.json();
    return (body.content || []).filter(b => b.type === 'text').map(b => b.text).join('').trim();
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────
  function addDays(isoDate, n) {
    const d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  }

  function _getSeasonName(month) {
    if (month >= 3 && month <= 5) return 'spring';
    if (month >= 6 && month <= 8) return 'summer';
    if (month >= 9 && month <= 11) return 'fall';
    return 'winter';
  }

  // ─── Full context (structured) ────────────────────────────────────────────────
  function getFullContext() {
    const today = DS.todayISO();
    const now   = new Date();
    const DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

    const user = {
      name:           window.storage.get('settings:user_name')    || 'User',
      briefingTime:   window.storage.get('settings:briefing_time') || '08:00',
      digestTime:     window.storage.get('settings:digest_time')   || '21:00',
      verbosity:      window.storage.get('settings:verbosity')     || 'normal',
      nudgeFrequency: window.storage.get('settings:nudge_freq')    || 'normal',
    };

    const todayCtx = {
      date:      today,
      dayOfWeek: DAY_NAMES[now.getDay()],
      season:    _getSeasonName(now.getMonth() + 1),
    };

    const week7         = addDays(today, 7);
    const allDeadlines  = DS.deadlines.list().filter(d => d.status !== 'done');
    const allOpenTasks  = DS.tasks.listOpen();

    const overdue = allDeadlines
      .filter(d => d.dueDate < today)
      .map(d => ({ id: d.id, title: d.title, dueDate: d.dueDate, daysLeft: DS.daysUntil(d.dueDate), category: d.category }));

    const dueToday = [
      ...allDeadlines.filter(d => d.dueDate === today)
        .map(d => ({ type: 'deadline', id: d.id, title: d.title })),
      ...allOpenTasks.filter(t => t.dueDate === today)
        .map(t => ({ type: 'task', id: t.id, title: t.title, priority: t.priority })),
    ];

    const dueThisWeek = [
      ...allDeadlines.filter(d => d.dueDate > today && d.dueDate <= week7)
        .map(d => ({ type: 'deadline', id: d.id, title: d.title, dueDate: d.dueDate, daysLeft: DS.daysUntil(d.dueDate) })),
      ...allOpenTasks.filter(t => t.dueDate && t.dueDate > today && t.dueDate <= week7)
        .map(t => ({ type: 'task', id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate })),
    ].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));

    const top3Tasks = DS.tasks.listByPriority()
      .filter(t => !t.completedAt)
      .slice(0, 3)
      .map(t => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate }));

    const deferredItems = DS.tasks.listChronicallyDeferred(3)
      .slice(0, 5)
      .map(t => ({ id: t.id, title: t.title, deferralCount: t.deferralCount, dueDate: t.dueDate }));

    const habitStreaks = DS.habits.list().map(h => ({
      id:            h.id,
      name:          h.name,
      frequency:     h.frequency,
      currentStreak: h.currentStreak,
      longestStreak: h.longestStreak,
      doneToday:     (h.log || []).some(e => e.date === today && e.done),
      adherence7d:   DS.habits.adherenceRate(h.id, 7),
    }));

    const medicationAdherence = DS.medications.list().map(m => ({
      id:               m.id,
      name:             m.name,
      dosage:           m.dosage,
      timeAnchor:       m.timeAnchor,
      takenToday:       (m.log || []).some(e => e.date === today && e.taken),
      currentStreak:    m.currentStreak,
      adherencePercent: m.adherencePercent,
    }));

    const familyPending = DS.family.list()
      .map(member => ({
        id:           member.id,
        name:         member.name,
        relationship: member.relationship,
        pendingTasks: (member.tasksAssigned || []).filter(a => a.status !== 'done').length,
      }))
      .filter(m => m.pendingTasks > 0);

    const recentActivity = DS.activity.list(6).map(a => ({
      type:      a.type,
      details:   a.details,
      timestamp: a.timestamp,
    }));

    return {
      user, today: todayCtx,
      overdue, dueToday, dueThisWeek,
      top3Tasks, deferredItems,
      habitStreaks, medicationAdherence,
      familyPending, recentActivity,
    };
  }

  // Kept for backward compatibility
  function buildContext() {
    const ctx   = getFullContext();
    const today = ctx.today.date;

    const deadlines = DS.deadlines.list()
      .filter(d => d.status !== 'done')
      .filter(d => DS.daysUntil(d.dueDate) <= 60)
      .sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate))
      .slice(0, 10)
      .map(d => ({ id: d.id, title: d.title, dueDate: d.dueDate, status: d.status, category: d.category, daysLeft: DS.daysUntil(d.dueDate) }));

    const tasks = DS.tasks.listByPriority()
      .filter(t => !t.completedAt)
      .slice(0, 8)
      .map(t => ({ id: t.id, title: t.title, priority: t.priority, dueDate: t.dueDate, deferralCount: t.deferralCount, assignedTo: t.assignedTo, category: t.category }));

    const habits = DS.habits.list().map(h => ({
      id: h.id, name: h.name, frequency: h.frequency, currentStreak: h.currentStreak,
      doneToday: (h.log || []).some(e => e.date === today && e.done),
    }));

    const medications = DS.medications.list().map(m => ({
      id: m.id, name: m.name, dosage: m.dosage, timeAnchor: m.timeAnchor,
      takenToday: (m.log || []).some(e => e.date === today && e.taken),
      currentStreak: m.currentStreak, adherencePercent: m.adherencePercent,
    }));

    const family = DS.family.list().map(m => ({ id: m.id, name: m.name, relationship: m.relationship, age: m.age }));
    const recentActivity = ctx.recentActivity;

    return { today, deadlines, tasks, habits, medications, family, recentActivity };
  }

  // ─── System prompt ────────────────────────────────────────────────────────────
  function getSystemPrompt() {
    const ctx  = getFullContext();
    const name = ctx.user.name;

    const verbosityNote = {
      brief:    'Be very concise — one or two sentences unless more detail is explicitly requested.',
      normal:   'Be conversational and clear. Include relevant detail but stay focused.',
      detailed: 'Be thorough. Explain reasoning and surface related considerations proactively.',
    }[ctx.user.verbosity] || 'Be conversational and clear.';

    const nudgeNote = {
      low:    'Only surface information when directly asked. Do not proactively mention pending items.',
      normal: 'Mention important pending items when naturally relevant to the conversation.',
      high:   'Actively remind about overdue tasks, unlogged habits, and upcoming deadlines.',
    }[ctx.user.nudgeFrequency] || 'Mention important pending items when naturally relevant.';

    return `You are Andy, an agentic personal life assistant for ${name}. You help manage deadlines, tasks, habits, medications, family responsibilities, and recurring to-dos. You are proactive, warm, and direct. You always confirm before creating or modifying data.

Communication style: ${verbosityNote}
Nudge style: ${nudgeNote}

When the user gives you a command, classify the intent and respond ONLY with a valid JSON object in this exact shape:
{
  "intent": "create_task|edit_task|create_deadline|log_habit|log_medication|add_medication|create_checklist|set_trigger|assign_family_task|defer_task|complete_task|query|reflect|converse",
  "confidence": 0.0-1.0,
  "data": { ...extracted fields },
  "confirmation": "Human-readable message — for data actions: what you're about to do. For query/reflect/converse: your actual answer.",
  "followup": "Clarifying question if required fields are missing, else null"
}

Intent field guidance:
- create_task       → data: { title, dueDate (YYYY-MM-DD|null), priority (P0-P3), category, assignedTo, notes, isRecurring, recurrenceRule }
- create_deadline   → data: { title, dueDate (YYYY-MM-DD), category (school|legal|license|insurance|registration|medical|financial|other), alertDays, assignedTo, notes }
- log_habit         → data: { name (habit name), id (if known), date (YYYY-MM-DD), done (bool) }
- log_medication    → data: { name (med name), id (if known), date (YYYY-MM-DD), taken (bool), takenAt (HH:MM|null) }
- add_medication    → data: { name, dosage, timeAnchor (morning|noon|evening|bedtime|custom), reminderTime, notes }
- create_checklist  → data: { title, season (spring|summer|fall|winter|anytime), items: [string] }
- set_trigger       → data: { title, conditionType (rate|price|date-range|custom), threshold, checkFrequency, actionDeadlineDays, notes }
- assign_family_task→ data: { title, dueDate, priority, memberName, memberId (if known), notes }
- edit_task         → data: { title or id, newTitle (optional), priority (optional), dueDate (optional, YYYY-MM-DD|null), category (optional), notes (optional) }
- defer_task        → data: { title or id, newDueDate (YYYY-MM-DD|null) }
- complete_task     → data: { title or id }
- query / reflect / converse → data: {} — put the full answer in "confirmation"

Date arithmetic rules:
- "in N days" = ${ctx.today.date} + N days
- "next week" = add 7 days from today
- "next month" = add 30 days from today
- Always output dates as YYYY-MM-DD strings.

IMPORTANT:
- Do NOT wrap your response in markdown code fences.
- Return ONLY the raw JSON object — no text before or after.
- If you genuinely cannot determine intent, use "converse" and answer naturally in "confirmation".

Current context (${ctx.today.date}, ${ctx.today.dayOfWeek}, ${ctx.today.season}):
${JSON.stringify(ctx, null, 2)}`;
  }

  // ─── Response parser ──────────────────────────────────────────────────────────
  function parseResponse(rawText) {
    if (!rawText || !rawText.trim()) return { type: 'text', raw: '…' };

    // Strip accidental markdown fences
    const stripped = rawText
      .replace(/^```json\s*/im, '')
      .replace(/^```\s*/im, '')
      .replace(/\s*```$/im, '')
      .trim();

    // Attempt direct parse
    try {
      const parsed = JSON.parse(stripped);
      if (parsed && parsed.intent) return { type: 'action', parsed, raw: rawText };
    } catch (_) {}

    // Attempt to extract first {...} block with an "intent" key
    const match = stripped.match(/\{[\s\S]*?"intent"[\s\S]*?\}/);
    if (match) {
      try {
        const parsed = JSON.parse(match[0]);
        if (parsed && parsed.intent) return { type: 'action', parsed, raw: rawText };
      } catch (_) {}
    }

    return { type: 'text', raw: rawText };
  }

  // ─── Intent executor ──────────────────────────────────────────────────────────
  // Returns { success: bool, entity: string, record: object|null, message: string|null }
  function execute(intent, data) {
    try {
      switch (intent) {

        case 'create_task': {
          const task = DS.tasks.create({
            title:          data.title,
            dueDate:        data.dueDate   || null,
            priority:       data.priority  || 'P2',
            category:       data.category  || '',
            assignedTo:     data.assignedTo || 'self',
            notes:          data.notes      || '',
            isRecurring:    !!data.isRecurring,
            recurrenceRule: data.recurrenceRule || null,
          });
          return { success: true, entity: 'task', record: task };
        }

        case 'create_deadline': {
          const dl = DS.deadlines.create({
            title:      data.title,
            category:   data.category  || 'other',
            dueDate:    data.dueDate,
            alertDays:  data.alertDays || [90, 60, 30, 14, 7, 3, 1],
            assignedTo: data.assignedTo || 'self',
            notes:      data.notes || '',
          });
          return { success: true, entity: 'deadline', record: dl };
        }

        case 'log_habit': {
          const habit = _findHabit(data);
          if (!habit) return { success: false, message: `Habit not found: "${data.name}"` };
          const result = DS.habits.logDay(habit.id, data.date || DS.todayISO(), data.done !== false);
          return { success: true, entity: 'habit', record: result };
        }

        case 'log_medication': {
          const med = _findMedication(data);
          if (!med) return { success: false, message: `Medication not found: "${data.name}"` };
          const result = DS.medications.logDose(
            med.id,
            data.date   || DS.todayISO(),
            data.taken  !== false,
            data.takenAt || null,
          );
          return { success: true, entity: 'medication', record: result };
        }

        case 'add_medication': {
          const med = DS.medications.create({
            name:         data.name,
            dosage:       data.dosage      || '',
            timeAnchor:   data.timeAnchor  || 'morning',
            customTime:   data.customTime  || null,
            reminderTime: data.reminderTime || null,
            notes:        data.notes || '',
          });
          return { success: true, entity: 'medication', record: med };
        }

        case 'create_checklist': {
          const list = DS.checklists.create({
            title:  data.title,
            season: data.season || 'anytime',
            items:  data.items  || [],
          });
          return { success: true, entity: 'checklist', record: list };
        }

        case 'set_trigger': {
          const trig = DS.triggers.create({
            title:              data.title,
            conditionType:      data.conditionType      || 'custom',
            threshold:          data.threshold          || '',
            checkFrequency:     data.checkFrequency     || 'daily',
            actionDeadlineDays: data.actionDeadlineDays || 7,
            notes:              data.notes || '',
          });
          return { success: true, entity: 'trigger', record: trig };
        }

        case 'assign_family_task': {
          const task = DS.tasks.create({
            title:      data.title,
            dueDate:    data.dueDate   || null,
            priority:   data.priority  || 'P2',
            assignedTo: data.memberId  || data.memberName || 'self',
            notes:      data.notes || '',
          });
          const member = data.memberId
            ? DS.family.get(data.memberId)
            : DS.family.list().find(m =>
                m.name.toLowerCase().includes((data.memberName || '').toLowerCase()));
          if (member) DS.family.assignTask(member.id, task.id, 'pending', data.dueDate || null);
          return { success: true, entity: 'task', record: task };
        }

        case 'edit_task': {
          const task = _findTask(data);
          if (!task) return { success: false, message: `Task not found: "${data.title}"` };
          const patch = {};
          if (data.newTitle  !== undefined) patch.title    = data.newTitle;
          if (data.priority  !== undefined) patch.priority = data.priority;
          if (data.dueDate   !== undefined) patch.dueDate  = data.dueDate;
          if (data.category  !== undefined) patch.category = data.category;
          if (data.notes     !== undefined) patch.notes    = data.notes;
          if (!Object.keys(patch).length) return { success: false, message: 'No changes specified.' };
          const updated = DS.tasks.update(task.id, patch);
          return { success: true, entity: 'task', record: updated };
        }

        case 'defer_task': {
          const task = _findTask(data);
          if (!task) return { success: false, message: `Task not found: "${data.title}"` };
          const updated = DS.tasks.defer(task.id, data.newDueDate || null);
          return { success: true, entity: 'task', record: updated };
        }

        case 'complete_task': {
          const task = _findTask(data);
          if (!task) return { success: false, message: `Task not found: "${data.title}"` };
          const completed = DS.tasks.complete(task.id);
          return { success: true, entity: 'task', record: completed };
        }

        case 'query':
        case 'reflect':
        case 'converse':
          // No data action — UI just displays parsed.confirmation as a regular message
          return { success: true, entity: 'none', record: null };

        default:
          return { success: false, message: `Unknown intent: ${intent}` };
      }
    } catch (err) {
      return { success: false, message: err.message };
    }
  }

  // ─── Fuzzy finders ────────────────────────────────────────────────────────────
  function _findHabit(data) {
    if (data.id) return DS.habits.get(data.id);
    if (!data.name) return null;
    const needle = data.name.toLowerCase();
    return DS.habits.list().find(h => h.name.toLowerCase().includes(needle)) || null;
  }

  function _findMedication(data) {
    if (data.id) return DS.medications.get(data.id);
    if (!data.name) return null;
    const needle = data.name.toLowerCase();
    return DS.medications.list().find(m => m.name.toLowerCase().includes(needle)) || null;
  }

  function _findTask(data) {
    if (data.id) return DS.tasks.get(data.id);
    if (!data.title) return null;
    const needle = data.title.toLowerCase();
    return DS.tasks.listOpen().find(t => t.title.toLowerCase().includes(needle)) || null;
  }

  // ─── Main API call ────────────────────────────────────────────────────────────
  /**
   * Send a user message to Claude with conversation history.
   * @param {string}   userMessage
   * @param {Array}    history      — [{role, content}] — plain text pairs only
   * @param {string}   apiKey
   * @returns {{ type: 'action'|'text', parsed?, raw: string }}
   */
  async function send(userMessage, history) {
    const msgHistory = history.map(m => ({ role: m.role, content: m.content }));
    const rawText = await callLLM(getSystemPrompt(), userMessage, 1024, msgHistory);
    return parseResponse(rawText);
  }

  // ─── Morning Briefing ─────────────────────────────────────────────────────────
  async function generateMorningBriefing() {
    const ctx   = buildContext();
    const today = ctx.today;

    const overdueTasks = ctx.tasks.filter(t => t.dueDate && t.dueDate < today);
    const dueTodayTasks = ctx.tasks.filter(t => t.dueDate === today);
    const topTasks = ctx.tasks.slice(0, 3);

    const urgentDeadlines = ctx.deadlines.filter(d => d.daysLeft <= 14);
    const habitsDoneToday = ctx.habits.filter(h => h.doneToday);
    const medsTakenToday  = ctx.medications.filter(m => m.takenToday);

    const briefPrompt = `Today is ${today}.

TASKS:
- Overdue (${overdueTasks.length}): ${overdueTasks.map(t => t.title).join(', ') || 'none'}
- Due today (${dueTodayTasks.length}): ${dueTodayTasks.map(t => t.title).join(', ') || 'none'}
- Top priority open: ${topTasks.map(t => `${t.title} (${t.priority})`).join(', ') || 'none'}

DEADLINES (next 14 days, ${urgentDeadlines.length}):
${urgentDeadlines.map(d => `- ${d.title}: ${d.daysLeft}d left`).join('\n') || '- none'}

HABITS (${habitsDoneToday.length}/${ctx.habits.length} done today):
${ctx.habits.map(h => `- ${h.name}: ${h.doneToday ? '✓' : '✗'} | streak ${h.currentStreak}d`).join('\n') || '- none tracked'}

MEDICATIONS (${medsTakenToday.length}/${ctx.medications.length} taken today):
${ctx.medications.map(m => `- ${m.name} ${m.dosage}: ${m.takenToday ? 'taken' : 'NOT taken'}`).join('\n') || '- none tracked'}

FAMILY:
${ctx.family.map(f => `- ${f.name} (${f.relationship})`).join('\n') || '- none'}`;

    return await callLLM(
      'You are Andy, a warm and direct personal life assistant. Write a morning briefing in plain text (no markdown, no bullet points, no headers). Under 150 words. Be specific and actionable. End with one encouraging sentence.',
      briefPrompt,
      400
    );
  }

  // ─── Public API ───────────────────────────────────────────────────────────────
  window.CS = { callLLM, send, execute, buildContext, getFullContext, generateMorningBriefing };

})();
