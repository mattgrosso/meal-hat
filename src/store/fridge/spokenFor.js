// SPOKEN FOR (2026-11-13): food the coming week's meals will use, so Today's
// idea does not suggest it.
//
// The idea is made from the tally, and the tally is everything in the house
// — including the chicken bought for Thursday's tacos. A suggestion that uses
// it up leaves a planned dinner short, which is the one way the idea could
// cost a meal instead of saving one.
//
// The wall makes the idea and cannot read the schedule (it is a member of no
// hat), so the signed-in app PUBLISHES what the schedule holds back, under the
// fridge, the same arrangement as the templates and the Magic Mirror feed. It
// is foods and package counts only: no meal names, nothing the wall shows.
//
// Stored per DAY, not as one total, so it goes out of date gracefully: if
// nobody signed in opens Meal Hat for a few days, the nights that have passed
// stop holding anything on their own, and the wall never keeps back food for
// a dinner already eaten.
//
// Free of Firebase imports so it can be tested directly.

import { aggregateMealIngredients } from '../ingredients'
import { toISODate, todayISO, datesInRange } from '../schedule'
import { templateKey } from './paths'

// How far ahead food is held: today and the six nights after it, which is one
// weekly shop. Food bought for a meal further out than that has usually not
// been bought yet.
export const SPOKEN_FOR_DAYS = 7

const norm = (text) => String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
const positive = (value) => {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : null
}
const round = (n) => Math.round(n * 100) / 100

// The days the publisher covers, today first.
export const spokenForDates = (now = new Date(), days = SPOKEN_FOR_DAYS) => {
  const today = todayISO(now)
  const end = new Date(`${today}T12:00:00`)
  end.setDate(end.getDate() + days - 1)
  return datesInRange(today, toISODate(end))
}

// What the schedule holds back, by day: { 'YYYY-MM-DD': { <foodKey>: { name,
// packages } } }. Worked out the way the shopping list works out a meal's
// needs (aggregateMealIngredients, so lesson nights and blank quantities count
// the same), then turned into PACKAGES, the unit a timer holds, through the
// food's packageSize. With no packageSize a meal is taken to use one whole
// package: the same assumption cooking a meal makes, and the direction that
// keeps more food back rather than less.
export const buildSpokenFor = ({ drawnMeals = [], getMeal = () => null, catalog = {}, now = new Date(), days = SPOKEN_FOR_DAYS } = {}) => {
  const dates = new Set(spokenForDates(now, days))
  const byDate = {}
  for (const row of drawnMeals || []) {
    const date = toISODate(row?.assignedDate)
    if (!date || !dates.has(date)) continue
    ;(byDate[date] = byDate[date] || []).push(row)
  }

  const out = {}
  for (const date of Object.keys(byDate).sort()) {
    const needs = aggregateMealIngredients({ drawnMeals: byDate[date], getMeal, catalog, now })
    const foods = {}
    for (const entry of Object.values(needs)) {
      const name = String(entry.name || '').trim()
      const key = templateKey(norm(name))
      if (!key || entry.fridgeOnly) continue
      const size = positive(entry.packageSize)
      const packages = size === null ? 1 : entry.quantity / size
      if (!(packages > 0)) continue
      const prior = foods[key]
      foods[key] = { name, packages: round((prior ? prior.packages : 0) + packages) }
    }
    if (Object.keys(foods).length) out[date] = foods
  }
  return out
}

// A stable string for "has this changed?", so an unchanged schedule writes
// nothing.
export const spokenForSignature = (days = {}) =>
  JSON.stringify(Object.keys(days || {}).sort().map((date) => [
    date,
    Object.keys(days[date] || {}).sort().map((key) => [key, days[date][key]?.packages])
  ]))

// The wall's half: food name -> packages held back, from today on. Days
// before `today` are ignored, so a stale publish releases food on its own.
export const heldBack = (days = {}, today) => {
  const held = new Map()
  for (const [date, foods] of Object.entries(days || {})) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || (today && date < today)) continue
    for (const food of Object.values(foods || {})) {
      const name = norm(food?.name)
      const packages = positive(food?.packages)
      if (!name || packages === null) continue
      held.set(name, (held.get(name) || 0) + packages)
    }
  }
  return held
}

// The tally with what is spoken for taken off. A food wholly held back drops
// out; one partly held back goes with only its spare amount. Names join
// exactly (lowercased, trimmed), as everywhere else between catalog and
// timers.
export const SPARE_EPSILON = 0.01
export const tallyLessSpokenFor = (tally = [], days = {}, today) => {
  const held = heldBack(days, today)
  if (!held.size) return tally
  return tally.flatMap((row) => {
    const hold = held.get(norm(row.title))
    if (!hold) return [row]
    const spare = round(row.quantity - hold)
    return spare > SPARE_EPSILON ? [{ ...row, quantity: spare }] : []
  })
}
