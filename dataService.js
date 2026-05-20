/**
 * Andy dataService.js
 * All reads/writes go through window.storage (localStorage wrapper).
 * Exported to window.DS — available globally after this script loads.
 */
(function () {
  'use strict';

  // ─── Internal helpers ──────────────────────────────────────────────────────
  const S = () => window.storage; // lazy so window.storage can be defined after this file loads

  function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
  }

  function nowISO() { return new Date().toISOString(); }

  function todayISO() { return new Date().toISOString().split('T')[0]; }

  function addDays(isoDate, n) {
    const d = new Date(isoDate + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.toISOString().split('T')[0];
  }

  function daysUntil(isoDate) {
    return Math.ceil((new Date(isoDate + 'T00:00:00') - new Date()) / 86400000);
  }

  // ─── listAll ───────────────────────────────────────────────────────────────
  /**
   * Returns all stored values whose key equals `prefix` or starts with `prefix:`.
   * Always returns a plain array of parsed objects (nulls filtered out).
   */
  function listAll(prefix) {
    return S()
      .keys()
      .filter(k => k === prefix || k.startsWith(prefix + ':'))
      .map(k => S().get(k))
      .filter(Boolean);
  }

  // ─── Activity log (internal) ───────────────────────────────────────────────
  function _logActivity(type, details, metadata = {}) {
    const ts = Date.now();
    S().set(`activity:${ts}`, {
      id:        `activity:${ts}`,
      timestamp: new Date(ts).toISOString(),
      type,
      details,
      metadata,
    });
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // 1. DEADLINES
  //    Key: deadlines:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const deadlines = {
    /**
     * @param {{ title, category?, dueDate, alertDays?, assignedTo?, notes? }} fields
     */
    create({ title, category = 'other', dueDate, alertDays = [90, 60, 30, 14, 7, 3, 1], assignedTo = 'self', notes = '' }) {
      const id = newId('dl');
      const record = {
        id,
        title,
        category,           // school|legal|license|insurance|registration|medical|financial|other
        dueDate,            // ISO string YYYY-MM-DD
        alertDays,          // days before due to fire alerts
        status: 'pending',  // pending|snoozed|done|overdue
        assignedTo,         // 'self' or a family member id
        notes,
        createdAt: nowISO(),
      };
      S().set(`deadlines:${id}`, record);
      _logActivity('deadline_created', `Created deadline: ${title}`, { id });
      return record;
    },

    get(id) { return S().get(`deadlines:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`deadlines:${id}`, updated);
      return updated;
    },

    delete(id) {
      S().delete(`deadlines:${id}`);
      _logActivity('deadline_deleted', `Deleted deadline ${id}`, { id });
    },

    list() { return listAll('deadlines'); },

    listByStatus(status) { return this.list().filter(d => d.status === status); },

    listByAssignee(assignedTo) { return this.list().filter(d => d.assignedTo === assignedTo); },

    /** Mark a deadline as done */
    markDone(id) { return this.update(id, { status: 'done' }); },

    /** Snooze a deadline */
    snooze(id) { return this.update(id, { status: 'snoozed' }); },

    /**
     * Scan all pending deadlines and flip any that are past due to 'overdue'.
     * Call once on app boot.
     */
    checkOverdue() {
      const today = todayISO();
      this.listByStatus('pending').forEach(d => {
        if (d.dueDate < today) {
          this.update(d.id, { status: 'overdue' });
          _logActivity('deadline_alert', `Deadline overdue: ${d.title}`, { id: d.id });
        }
      });
    },

    /**
     * Returns deadlines whose alertDays include the exact number of days remaining.
     * Use for daily notification checks.
     */
    getDueAlerts() {
      const today = todayISO();
      return this.listByStatus('pending').reduce((acc, d) => {
        const days = Math.ceil((new Date(d.dueDate + 'T00:00:00') - new Date(today + 'T00:00:00')) / 86400000);
        if ((d.alertDays || []).includes(days)) acc.push({ ...d, daysLeft: days });
        return acc;
      }, []);
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 2. TASKS
  //    Key: tasks:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const tasks = {
    /**
     * @param {{ title, dueDate?, priority?, category?, isRecurring?, recurrenceRule?, assignedTo?, notes? }} fields
     */
    create({ title, dueDate = null, priority = 'P2', category = '', isRecurring = false, recurrenceRule = null, assignedTo = 'self', notes = '' }) {
      const id = newId('task');
      const record = {
        id,
        title,
        dueDate,
        priority,        // P0|P1|P2|P3
        category,
        deferralCount: 0,
        isRecurring,
        recurrenceRule,  // daily|weekly|monthly|null
        completedAt: null,
        assignedTo,
        notes,
        createdAt: nowISO(),
      };
      S().set(`tasks:${id}`, record);
      _logActivity('task_created', `Created task: ${title}`, { id, priority });
      return record;
    },

    get(id) { return S().get(`tasks:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`tasks:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`tasks:${id}`); },

    list() { return listAll('tasks'); },

    /** Mark complete. Spawns a new instance for recurring tasks. */
    complete(id) {
      const task = this.update(id, { completedAt: nowISO() });
      if (!task) return null;
      _logActivity('task_completed', `Completed: ${task.title}`, { id });
      if (task.isRecurring && task.recurrenceRule) this._spawnRecurrence(task);
      return task;
    },

    /** Increment deferral counter and optionally shift the due date. */
    defer(id, newDueDate = null) {
      const task = this.get(id);
      if (!task) return null;
      const updated = this.update(id, {
        deferralCount: (task.deferralCount || 0) + 1,
        dueDate:       newDueDate || task.dueDate,
      });
      _logActivity('task_deferred', `Deferred: ${task.title} (${updated.deferralCount}×)`, { id, deferralCount: updated.deferralCount });
      return updated;
    },

    _spawnRecurrence(task) {
      const base = task.dueDate || todayISO();
      const nextDate = this._nextDate(base, task.recurrenceRule);
      this.create({
        title:          task.title,
        dueDate:        nextDate,
        priority:       task.priority,
        category:       task.category,
        isRecurring:    true,
        recurrenceRule: task.recurrenceRule,
        assignedTo:     task.assignedTo,
        notes:          task.notes,
      });
    },

    _nextDate(fromISO, rule) {
      const d = new Date(fromISO + 'T00:00:00');
      if (rule === 'daily')   d.setDate(d.getDate() + 1);
      if (rule === 'weekly')  d.setDate(d.getDate() + 7);
      if (rule === 'monthly') d.setMonth(d.getMonth() + 1);
      return d.toISOString().split('T')[0];
    },

    /** Sorted P0 → P3 */
    listByPriority() { return this.list().sort((a, b) => a.priority.localeCompare(b.priority)); },

    listByAssignee(assignedTo) { return this.list().filter(t => t.assignedTo === assignedTo); },

    listOpen() { return this.list().filter(t => !t.completedAt); },

    listOverdue() {
      const today = todayISO();
      return this.listOpen().filter(t => t.dueDate && t.dueDate < today);
    },

    /** Tasks deferred more than `threshold` times (default 2) */
    listChronicallyDeferred(threshold = 2) {
      return this.listOpen().filter(t => (t.deferralCount || 0) >= threshold);
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 3. FAMILY MEMBERS
  //    Key: family:members:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const family = {
    /**
     * @param {{ name, role?, age?, relationship, escalationContactId? }} fields
     */
    create({ name, role = 'dependent', age = null, relationship, escalationContactId = null }) {
      const id = newId('member');
      const record = {
        id,
        name,
        role,              // self|dependent
        age,
        relationship,      // self|son|daughter|spouse|parent
        tasksAssigned: [], // [{ taskId, status, dueDate }]
        escalationContactId,
      };
      S().set(`family:members:${id}`, record);
      return record;
    },

    get(id) { return S().get(`family:members:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`family:members:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`family:members:${id}`); },

    list() { return listAll('family:members'); },

    /** Attach a task assignment to a family member */
    assignTask(memberId, taskId, status = 'pending', dueDate = null) {
      const member = this.get(memberId);
      if (!member) return null;
      const tasksAssigned = member.tasksAssigned.filter(t => t.taskId !== taskId);
      tasksAssigned.push({ taskId, status, dueDate });
      return this.update(memberId, { tasksAssigned });
    },

    removeTask(memberId, taskId) {
      const member = this.get(memberId);
      if (!member) return null;
      return this.update(memberId, {
        tasksAssigned: member.tasksAssigned.filter(t => t.taskId !== taskId),
      });
    },

    updateTaskStatus(memberId, taskId, status) {
      const member = this.get(memberId);
      if (!member) return null;
      return this.update(memberId, {
        tasksAssigned: member.tasksAssigned.map(t => t.taskId === taskId ? { ...t, status } : t),
      });
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 4. HABITS
  //    Key: habits:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const habits = {
    /**
     * @param {{ name, frequency?, category?, targetDays? }} fields
     */
    create({ name, frequency = 'daily', category = 'other', targetDays = 66 }) {
      const id = newId('habit');
      const record = {
        id,
        name,
        frequency,      // daily|weekly
        currentStreak:  0,
        longestStreak:  0,
        log:            [], // [{ date: YYYY-MM-DD, done: bool }]
        category,       // health|fitness|learning|finance|other
        targetDays,
      };
      S().set(`habits:${id}`, record);
      return record;
    },

    get(id) { return S().get(`habits:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`habits:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`habits:${id}`); },

    list() { return listAll('habits'); },

    /** Log a day's completion and recalc streaks. */
    logDay(id, date = todayISO(), done = true) {
      const habit = this.get(id);
      if (!habit) return null;
      // Upsert the log entry for this date
      const log = habit.log.filter(e => e.date !== date);
      log.push({ date, done });
      this.update(id, { log });
      const result = this.recalcStreaks(id);
      _logActivity('habit_logged', `"${habit.name}" on ${date}: ${done ? '✓' : '✗'}`, { id, done });
      return result;
    },

    /** Recompute currentStreak and longestStreak from the log. */
    recalcStreaks(id) {
      const habit = this.get(id);
      if (!habit) return null;

      const doneDates = new Set(habit.log.filter(e => e.done).map(e => e.date));

      // Walk backwards from today; also accept yesterday as a valid streak start
      let current = 0;
      let cursor = todayISO();
      for (let i = 0; i < 730; i++) {
        if (doneDates.has(cursor)) {
          current++;
          cursor = addDays(cursor, -1);
        } else {
          // Allow one grace day only at position 0 (today not yet logged)
          if (i === 0) { cursor = addDays(cursor, -1); continue; }
          break;
        }
      }

      const longest = Math.max(habit.longestStreak || 0, current);
      return this.update(id, { currentStreak: current, longestStreak: longest });
    },

    /** Adherence % over last N days */
    adherenceRate(id, days = 30) {
      const habit = this.get(id);
      if (!habit) return 0;
      const cutoff = addDays(todayISO(), -days);
      const recent = habit.log.filter(e => e.date >= cutoff);
      return recent.length ? Math.round(recent.filter(e => e.done).length / days * 100) : 0;
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 5. MEDICATIONS
  //    Key: medications:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const medications = {
    /**
     * @param {{ name, dosage, timeAnchor?, customTime?, reminderTime?, notes? }} fields
     */
    create({ name, dosage, timeAnchor = 'morning', customTime = null, reminderTime = null, notes = '' }) {
      const id = newId('med');
      const record = {
        id,
        name,
        dosage,
        timeAnchor,      // morning|noon|evening|bedtime|custom
        customTime,      // HH:MM (used when timeAnchor === 'custom')
        currentStreak:   0,
        adherencePercent: 0,
        reminderTime,    // HH:MM
        log:             [], // [{ date, taken: bool, takenAt: HH:MM|null }]
        notes,
      };
      S().set(`medications:${id}`, record);
      return record;
    },

    get(id) { return S().get(`medications:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`medications:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`medications:${id}`); },

    list() { return listAll('medications'); },

    /** Log a dose and recalculate adherence + streak. */
    logDose(id, date = todayISO(), taken = true, takenAt = null) {
      const med = this.get(id);
      if (!med) return null;
      const resolvedTakenAt = takenAt || (taken ? new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : null);
      const log = med.log.filter(e => e.date !== date);
      log.push({ date, taken, takenAt: resolvedTakenAt });
      this.update(id, { log });
      return this.recalcAdherence(id);
    },

    /** Recompute adherencePercent (30-day window) and currentStreak. */
    recalcAdherence(id) {
      const med = this.get(id);
      if (!med) return null;

      const cutoff = addDays(todayISO(), -30);
      const last30 = med.log.filter(e => e.date >= cutoff);
      const adherencePercent = last30.length
        ? Math.round(last30.filter(e => e.taken).length / 30 * 100)
        : 0;

      // Streak (consecutive taken days walking back from today)
      const takenDates = new Set(med.log.filter(e => e.taken).map(e => e.date));
      let streak = 0, cursor = todayISO();
      for (let i = 0; i < 365; i++) {
        if (takenDates.has(cursor)) { streak++; cursor = addDays(cursor, -1); }
        else if (i === 0) { cursor = addDays(cursor, -1); } // grace: today not yet logged
        else break;
      }

      return this.update(id, { adherencePercent, currentStreak: streak });
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 6. CHECKLISTS
  //    Key: checklists:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const checklists = {
    /**
     * @param {{ title, season?, items? }} fields
     * items can be strings or partial item objects
     */
    create({ title, season = 'anytime', items = [] }) {
      const id = newId('list');
      const normalise = i =>
        typeof i === 'string'
          ? { id: newId('ci'), name: i, status: 'pending', notes: '', targetDate: null }
          : { id: newId('ci'), status: 'pending', notes: '', targetDate: null, ...i };
      const record = {
        id,
        title,
        season,    // spring|summer|fall|winter|anytime
        items:     items.map(normalise),
        createdAt: nowISO(),
      };
      S().set(`checklists:${id}`, record);
      return record;
    },

    get(id) { return S().get(`checklists:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`checklists:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`checklists:${id}`); },

    list() { return listAll('checklists'); },

    addItem(listId, { name, notes = '', targetDate = null }) {
      const list = this.get(listId);
      if (!list) return null;
      const item = { id: newId('ci'), name, status: 'pending', notes, targetDate };
      return this.update(listId, { items: [...list.items, item] });
    },

    updateItem(listId, itemId, patch) {
      const list = this.get(listId);
      if (!list) return null;
      return this.update(listId, {
        items: list.items.map(i => i.id === itemId ? { ...i, ...patch } : i),
      });
    },

    removeItem(listId, itemId) {
      const list = this.get(listId);
      if (!list) return null;
      return this.update(listId, { items: list.items.filter(i => i.id !== itemId) });
    },

    listBySeason(season) {
      return this.list().filter(c => c.season === 'anytime' || c.season === season);
    },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 7. TRIGGER ALERTS
  //    Key: trigger_alerts:{id}
  // ══════════════════════════════════════════════════════════════════════════════
  const triggers = {
    /**
     * @param {{ title, conditionType, threshold, checkFrequency?, actionDeadlineDays?, notes? }} fields
     */
    create({ title, conditionType, threshold, checkFrequency = 'daily', actionDeadlineDays = 7, notes = '' }) {
      const id = newId('trig');
      const record = {
        id,
        title,
        conditionType,      // rate|price|date-range|custom
        threshold,          // float or string depending on conditionType
        checkFrequency,     // daily|weekly
        status: 'watching', // watching|triggered|acted|expired
        actionDeadlineDays,
        triggeredAt: null,
        notes,
      };
      S().set(`trigger_alerts:${id}`, record);
      return record;
    },

    get(id) { return S().get(`trigger_alerts:${id}`); },

    update(id, patch) {
      const rec = this.get(id);
      if (!rec) return null;
      const updated = { ...rec, ...patch };
      S().set(`trigger_alerts:${id}`, updated);
      return updated;
    },

    delete(id) { S().delete(`trigger_alerts:${id}`); },

    list() { return listAll('trigger_alerts'); },

    /** Mark the trigger as fired */
    fire(id) {
      const t = this.update(id, { status: 'triggered', triggeredAt: nowISO() });
      if (t) _logActivity('trigger_fired', `Trigger fired: ${t.title}`, { id });
      return t;
    },

    /** Mark the trigger as acted upon */
    act(id) { return this.update(id, { status: 'acted' }); },

    /** Mark the trigger as expired */
    expire(id) { return this.update(id, { status: 'expired' }); },

    listWatching()   { return this.list().filter(t => t.status === 'watching'); },
    listTriggered()  { return this.list().filter(t => t.status === 'triggered'); },
  };

  // ══════════════════════════════════════════════════════════════════════════════
  // 8. ACTIVITY LOG
  //    Key: activity:{timestamp_ms}
  // ══════════════════════════════════════════════════════════════════════════════
  const activity = {
    /**
     * Append a log entry.
     * @param {string} type  - task_completed|task_deferred|habit_logged|deadline_alert|escalation_sent|trigger_fired|chat_message
     * @param {string} details
     * @param {object} [metadata]
     */
    log(type, details, metadata = {}) {
      const ts = Date.now();
      const record = {
        id:        `activity:${ts}`,
        timestamp: new Date(ts).toISOString(),
        type,
        details,
        metadata,
      };
      S().set(record.id, record);
      return record;
    },

    /** Most-recent-first, capped at `limit` entries. */
    list(limit = 100) {
      return listAll('activity')
        .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
        .slice(0, limit);
    },

    listByType(type)      { return this.list(500).filter(e => e.type === type); },

    listSince(isoOrMs) {
      const cutoff = new Date(isoOrMs);
      return this.list(500).filter(e => new Date(e.timestamp) >= cutoff);
    },
  };

  // ── Journal ───────────────────────────────────────────────────────────────────
  const journal = (() => {
    const key = id => `journal:${id}`;
    const all = () => window.storage.getAll('journal');
    return {
      create(data) {
        const entry = {
          id:        genId('j'),
          date:      data.date    || todayISO(),
          content:   data.content || '',
          mood:      data.mood    || null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        window.storage.set(key(entry.id), entry);
        return entry;
      },
      get(id)       { return window.storage.get(key(id)); },
      getByDate(date) {
        return Object.values(all()).filter(e => e && e.date === date);
      },
      list() {
        return Object.values(all())
          .filter(Boolean)
          .sort((a, b) => b.date.localeCompare(a.date));
      },
      update(id, patch) {
        const entry = this.get(id);
        if (!entry) return null;
        const updated = { ...entry, ...patch, updatedAt: Date.now() };
        window.storage.set(key(id), updated);
        return updated;
      },
      delete(id) { window.storage.delete(key(id)); },
    };
  })();

  // ══════════════════════════════════════════════════════════════════════════════
  // Public API
  // ══════════════════════════════════════════════════════════════════════════════
  window.DS = {
    // utilities
    listAll,
    addDays,
    todayISO,
    nowISO,
    daysUntil,
    // entities
    deadlines,
    tasks,
    family,
    habits,
    medications,
    checklists,
    triggers,
    activity,
    journal,
  };

})();
