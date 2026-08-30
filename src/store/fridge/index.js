// The fridge: countdown timers for things that go off, ported from perishable.
//
// Registered as a NAMESPACED module rather than folded into the main store,
// for two reasons. The fridge is reached by a different door — the wall tablet
// arrives with a capability key and no Google session — so its state has to be
// able to exist when `userEmail` is null and no hat is loaded. And every other
// hat in the database is fridgeless; keeping this self-contained is what makes
// the feature opt-in rather than a schema change landing in 13 accounts.

import { ref, push, set, update, remove, onValue, query, limitToLast } from 'firebase/database'
import { db, ensureSession } from '@/firebase'
import { sortTimers, spanInDays, formatDaySpan } from './timers'
import { sortHistory, HISTORY_LIMIT } from './history'
import { timersPath, templatesPath, historyPath, templateKey } from './paths'
import { reconcileShelfLives, fridgeFoodId } from './reconcile'

export default {
  namespaced: true,

  state: () => ({
    fridgeKey: null,
    timers: {},
    templates: {},
    history: {},
    loading: false,
    subscribedTo: null,

    // 'unauthorized' means the database REFUSED us (bad or revoked key). The
    // wall display turns that into a loud full-screen state, because on a
    // screen nobody interacts with, a quiet failure is an invisible one.
    error: null
  }),

  getters: {
    allTimers: (state) => sortTimers(state.timers),
    timerById: (state) => (id) => state.timers[id],
    templates: (state) => Object.values(state.templates),
    history: (state) => sortHistory(state.history),
    hasFridge: (state) => Boolean(state.fridgeKey),

    // Shelf life by normalized food name, for the staple logic on the shopping
    // list. This is the whole point of the merge: `lastPurchased` plus a
    // 60-day default is a GUESS at whether the olive oil is still there, and
    // the fridge holds the answer.
    shelfLifeByName: (state) => {
      const out = {}
      Object.values(state.templates || {}).forEach((template) => {
        if (!template?.title || !Number.isInteger(template.days)) return
        out[String(template.title).trim().toLowerCase()] = template.days
      })
      return out
    }
  },

  mutations: {
    SET_FRIDGE_KEY (state, key) { state.fridgeKey = key || null },
    SET_LOADING (state, loading) { state.loading = loading },
    SET_ERROR (state, error) { state.error = error },
    SET_TIMERS (state, timers) { state.timers = timers || {} },
    SET_TEMPLATES (state, templates) { state.templates = templates || {} },
    SET_HISTORY (state, history) { state.history = history || {} },
    SET_SUBSCRIBED_TO (state, key) { state.subscribedTo = key || null },
    CLEAR (state) {
      state.timers = {}
      state.templates = {}
      state.history = {}
      state.error = null
      state.subscribedTo = null
    }
  },

  actions: {
    // Attach the listeners for one fridge.
    //
    // Guarded on `subscribedTo` rather than on the data being empty. An empty
    // fridge is a perfectly normal answer — it is what a brand new one looks
    // like — so an emptiness check would re-attach a fresh listener every time
    // the route was entered.
    async subscribe ({ commit, state }, fridgeKey) {
      const key = fridgeKey || state.fridgeKey
      if (!key) {
        commit('SET_ERROR', 'unauthorized')
        return
      }
      if (state.subscribedTo === key) return

      commit('SET_FRIDGE_KEY', key)
      commit('SET_SUBSCRIBED_TO', key)
      commit('SET_LOADING', true)

      // The token has to exist before the first read, or the SDK sends the
      // request unauthenticated and the rules answer with a permission error
      // that reads exactly like a bad key.
      await ensureSession()

      onValue(ref(db, timersPath(key)), (snapshot) => {
        commit('SET_TIMERS', snapshot.val())
        commit('SET_ERROR', null)
        commit('SET_LOADING', false)
      }, (error) => {
        console.error('Failed to load fridge timers:', error)
        commit('SET_ERROR', 'unauthorized')
        commit('SET_LOADING', false)
      })

      onValue(ref(db, templatesPath(key)), (snapshot) => {
        commit('SET_TEMPLATES', snapshot.val())
      }, (error) => {
        console.error('Failed to load fridge templates:', error)
      })

      // Bounded, and its failure is swallowed on purpose: the timers are the
      // app, the change log is a convenience.
      onValue(query(ref(db, historyPath(key)), limitToLast(HISTORY_LIMIT)), (snapshot) => {
        commit('SET_HISTORY', snapshot.val())
      }, (error) => {
        console.error('Failed to load fridge history:', error)
      })
    },

    // Write one line to the change log. Deliberately fire-and-forget and
    // deliberately silent on failure: a log that can break a real write is
    // worse than no log at all.
    async recordHistory ({ state }, entry) {
      if (!state.fridgeKey) return
      try {
        // Firebase rejects the whole write if any value is undefined, and a
        // missing title would take the entire line down with it.
        const record = { at: new Date().toISOString(), source: 'hand', ...entry }
        for (const field of Object.keys(record)) {
          if (record[field] === undefined) record[field] = ''
        }
        await push(ref(db, historyPath(state.fridgeKey)), record)
      } catch (error) {
        console.error('Failed to record fridge history:', error)
      }
    },

    // `source` says where the add came from and is a log field, not part of
    // the timer.
    async addTimer ({ commit, state, dispatch }, { source = 'hand', ...timer }) {
      try {
        commit('SET_LOADING', true)
        const newTimerRef = push(ref(db, timersPath(state.fridgeKey)))
        const timerData = { ...timer, createdAt: new Date().toISOString() }

        await set(newTimerRef, timerData)
        commit('SET_ERROR', null)

        const days = spanInDays(timerData.createdAt, timerData.expiryDate)
        dispatch('recordHistory', {
          action: 'added',
          title: timerData.title,
          detail: days ? formatDaySpan(days) : '',
          source
        })
      } catch (error) {
        commit('SET_ERROR', 'Failed to add timer')
        console.error('Error adding fridge timer:', error)
      } finally {
        commit('SET_LOADING', false)
      }
    },

    // Accepts a bare id or { id, source }.
    async removeTimer ({ commit, state, dispatch }, payload) {
      const id = typeof payload === 'string' ? payload : payload?.id
      const source = (typeof payload === 'object' && payload?.source) || 'hand'
      // Read the title BEFORE the delete — afterwards there is nothing left to
      // name, and "removed something" is a useless line in a change log.
      const title = state.timers[id]?.title || ''
      try {
        commit('SET_LOADING', true)
        await remove(ref(db, `${timersPath(state.fridgeKey)}/${id}`))
        commit('SET_ERROR', null)
        dispatch('recordHistory', { action: 'removed', title, source })
      } catch (error) {
        commit('SET_ERROR', 'Failed to remove timer')
        console.error('Error removing fridge timer:', error)
      } finally {
        commit('SET_LOADING', false)
      }
    },

    // `addedDays` is what the edit actually changed, passed through so the log
    // can say "+1 week" rather than just "changed".
    async updateTimer ({ commit, state, dispatch }, { id, timer, source = 'edit', addedDays = 0 }) {
      try {
        commit('SET_LOADING', true)
        await set(ref(db, `${timersPath(state.fridgeKey)}/${id}`), {
          ...timer,
          updatedAt: new Date().toISOString()
        })
        commit('SET_ERROR', null)
        dispatch('recordHistory', {
          action: 'extended',
          title: timer.title,
          detail: addedDays > 0 ? `+${formatDaySpan(addedDays)}` : '',
          source
        })
      } catch (error) {
        commit('SET_ERROR', 'Failed to update timer')
        console.error('Error updating fridge timer:', error)
      } finally {
        commit('SET_LOADING', false)
      }
    },

    async saveTemplate ({ state, dispatch }, { source = 'scan', ...template }) {
      // What the fridge believed before this write, so a changed shelf life can
      // be logged. This is the drift that bit us: a re-taught template silently
      // rewrote how long a food lasts, forever, with no record.
      const previous = state.templates[templateKey(template.title)]
      try {
        await set(ref(db, `${templatesPath(state.fridgeKey)}/${templateKey(template.title)}`), {
          ...template,
          createdAt: new Date().toISOString()
        })
      } catch (error) {
        console.error('Failed to save fridge template:', error)
        return
      }

      if (previous && Number.isInteger(previous.days) &&
          Number.isInteger(template.days) && previous.days !== template.days) {
        dispatch('recordHistory', {
          action: 'relearned',
          title: template.title,
          detail: `now ${formatDaySpan(template.days)}, was ${formatDaySpan(previous.days)}`,
          source
        })
      }
    },

    async removeTemplate ({ state }, title) {
      try {
        await remove(ref(db, `${templatesPath(state.fridgeKey)}/${templateKey(title)}`))
      } catch (error) {
        console.error('Failed to remove fridge template:', error)
      }
    },

    // Bring the catalog and the fridge's templates back into agreement.
    //
    // ONLY a signed-in client may run this: it writes the grocery catalog,
    // which the wall tablet cannot even read. The wall keeps teaching templates
    // and this picks the knowledge up next time a phone opens the app.
    //
    // Writes are MERGED, never set. Writing the whole grocery-catalog node from
    // a computed object would clobber concurrent edits and anything added on
    // another device — the invariant CLAUDE.md spells out.
    async reconcileCatalog ({ state, rootState, dispatch }) {
      const hat = rootState.databaseTopKey
      if (!hat || !state.fridgeKey) return
      // No catalog yet means the subscription has not filled in, not that the
      // catalog is empty. Reconciling against nothing would publish nothing and
      // adopt everything as a new food.
      if (!Object.keys(rootState.groceryCatalog || {}).length) return

      const { toCatalog, toTemplates, newFoods, conflicts } = reconcileShelfLives({
        catalog: rootState.groceryCatalog,
        templates: state.templates
      })

      const patch = {}
      toCatalog.forEach((item) => {
        // The value AND the base move together. Recording the base is what
        // makes the next edit attributable to the side that made it.
        patch[`${item.id}/shelfLifeDays`] = item.days
        patch[`${item.id}/shelfLifeSyncedDays`] = item.days
      })
      newFoods.forEach((item) => {
        const id = fridgeFoodId(item.title)
        patch[id] = {
          id,
          name: item.title,
          shelfLifeDays: item.days,
          shelfLifeSyncedDays: item.days,
          ...(item.fridgeOnly ? { fridgeOnly: true } : {})
        }
      })

      try {
        if (Object.keys(patch).length) {
          await update(ref(db, `${hat}/grocery-catalog`), patch)
        }
        for (const item of toTemplates) {
          await dispatch('saveTemplate', { title: item.title, days: item.days, source: 'catalog' })
        }
      } catch (error) {
        // Non-fatal by design. A failed sync leaves both copies as they were;
        // it does not cost anyone a timer or a shopping-list row.
        console.error('Failed to reconcile the fridge with the catalog:', error)
        return
      }

      conflicts.forEach((c) => {
        console.warn(
          `Shelf life for ${c.name}: the fridge says ${c.fromFridge}d, the catalog said ` +
          `${c.inCatalog}d, both changed from ${c.base}d. Took the fridge's.`
        )
      })
    }
  }
}
