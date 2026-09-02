import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTripCalendar, countCalendarEvents } from './tripCalendar.ts'

const plan = {
  city: '贵阳',
  start_date: '2026-09-01',
  end_date: '2026-09-02',
  days: [
    {
      date: '2026-09-01',
      day_index: 0,
      attractions: [
        {
          name: '黄果树大瀑布',
          address: '安顺市镇宁县',
          location: { longitude: 105.6, latitude: 25.9 },
          visit_duration: 120,
          description: '亚洲最大瀑布之一',
          start_time: '09:30',
          end_time: '11:30',
        },
        {
          name: '天星桥',
          address: '安顺市',
          location: { longitude: 105.7, latitude: 25.9 },
          visit_duration: 90,
          description: '',
        },
      ],
      meals: [{ type: 'lunch', name: '本地酸汤鱼', address: '景区门口' }],
    },
    {
      date: 'not-a-date',
      day_index: 1,
      attractions: [{ name: '被跳过的景点', location: { longitude: 1, latitude: 1 } }],
      meals: [],
    },
  ],
}

test('emits CRLF-terminated calendar with matching BEGIN/END counts', () => {
  const ics = buildTripCalendar(plan)
  assert.ok(ics.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(ics.endsWith('END:VCALENDAR\r\n'))
  assert.equal(ics.match(/BEGIN:VEVENT/g).length, 3)
  assert.equal(ics.match(/END:VEVENT/g).length, 3)
  // 每行都必须以 CRLF 分隔，不能出现裸 LF
  assert.equal(ics.split('\r\n').some(line => line.includes('\n')), false)
})

test('skips days whose date cannot be parsed', () => {
  assert.equal(countCalendarEvents(plan), 3)
  assert.ok(!buildTripCalendar(plan).includes('被跳过的景点'))
})

test('uses explicit times and chains undated attractions after the previous one', () => {
  const ics = buildTripCalendar(plan)
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20260901T093000'))
  assert.ok(ics.includes('DTEND;TZID=Asia/Shanghai:20260901T113000'))
  // 天星桥无时间：上一项 11:30 结束 + 30 分缓冲 = 12:00，时长 90 分
  assert.ok(ics.includes('DTSTART;TZID=Asia/Shanghai:20260901T120000'))
  assert.ok(ics.includes('DTEND;TZID=Asia/Shanghai:20260901T133000'))
  // 午餐无时间，落到默认 12:00
  assert.ok(ics.includes('SUMMARY:本地酸汤鱼'))
})

test('escapes special characters in text values', () => {
  const ics = buildTripCalendar({
    city: '测试',
    start_date: '2026-09-01',
    end_date: '2026-09-01',
    days: [{
      date: '2026-09-01',
      day_index: 0,
      attractions: [{
        name: 'A;B,C\\D',
        description: 'line1\nline2',
        location: { longitude: 116, latitude: 39 },
        start_time: '10:00',
        visit_duration: 60,
      }],
      meals: [],
    }],
  })
  assert.ok(ics.includes('SUMMARY:A\\;B\\,C\\\\D'))
  assert.ok(ics.includes('DESCRIPTION:line1\\nline2'))
})

test('folds long lines without splitting multi-byte characters', () => {
  const ics = buildTripCalendar({
    city: '测试',
    start_date: '2026-09-01',
    end_date: '2026-09-01',
    days: [{
      date: '2026-09-01',
      day_index: 0,
      attractions: [{
        name: '景'.repeat(60),
        location: { longitude: 116, latitude: 39 },
        start_time: '10:00',
        visit_duration: 60,
      }],
      meals: [],
    }],
  })
  const encoder = new TextEncoder()
  for (const line of ics.split('\r\n')) {
    assert.ok(encoder.encode(line).length <= 75, `line too long: ${line}`)
  }
  // 折行后去掉续行前导空格，原文必须完整还原
  assert.ok(ics.replace(/\r\n /g, '').includes(`SUMMARY:${'景'.repeat(60)}`))
})

test('adds a reminder alarm per event and can be disabled', () => {
  assert.equal(buildTripCalendar(plan).match(/BEGIN:VALARM/g).length, 3)
  assert.ok(buildTripCalendar(plan).includes('TRIGGER:-PT30M'))
  assert.equal(buildTripCalendar(plan, { alarmMinutesBefore: 0 }).includes('VALARM'), false)
})

test('produces byte-identical output across repeated exports', () => {
  assert.equal(buildTripCalendar(plan), buildTripCalendar(plan))
})

test('handles an empty plan without throwing', () => {
  const ics = buildTripCalendar({ city: '', start_date: '', end_date: '', days: [] })
  assert.ok(ics.includes('BEGIN:VCALENDAR'))
  assert.equal(ics.includes('BEGIN:VEVENT'), false)
})
