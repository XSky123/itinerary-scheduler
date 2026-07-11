import { useState, useEffect, useRef, useMemo } from 'react'
import dayjs from 'dayjs'
import { shallow } from 'zustand/shallow'
import { useTimelineStore } from '../store/timelineStore'
import type { TransitOption, TransitType } from '../lib/models'
import { getRowColor } from '../lib/rowColors'

const TYPE_LABELS: Record<TransitType, string> = {
  flight: '飞机', train: '火车', bus: '巴士', shuttle: '摆渡', custom: '自定义',
}
const TYPE_EMOJI: Record<TransitType, string> = {
  flight: '✈', train: '🚄', bus: '🚌', shuttle: '🚐', custom: '🚗',
}

// ── Time text parsing (date removed from UI) ─────────────────────────────────

function normalize(s: string): string {
  return s.replace(/：/g, ':').replace(/　/g, ' ').trim()
}

function parseTimeStr(raw: string): string | null {
  const s = normalize(raw)
  const m1 = s.match(/^(\d{1,2}):(\d{2})$/)
  if (m1) { const h = +m1[1], mm = +m1[2]; if (h <= 23 && mm <= 59) return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}` }
  const m2 = s.match(/^(\d{3,4})$/)
  if (m2) { const p = m2[0].padStart(4,'0'); const h = +p.slice(0,2), mm = +p.slice(2); if (h <= 23 && mm <= 59) return `${String(h).padStart(2,'0')}:${String(mm).padStart(2,'0')}` }
  const m3 = s.match(/^(\d{1,2})$/)
  if (m3) { const h = +m3[1]; if (h <= 23) return `${String(h).padStart(2,'0')}:00` }
  return null
}

// ── Transit card ──────────────────────────────────────────────────────────────

interface EditFields {
  type: TransitType; name: string; category: string
  depTime: string; arrTime: string; notes: string
  _date: string  // internal only, not shown
}

function fieldsFromTransit(t: TransitOption): EditFields {
  return {
    type: t.type, name: t.name, category: t.category ?? '',
    _date: dayjs(t.departureTime).format('YYYY-MM-DD'),
    depTime: dayjs(t.departureTime).format('HH:mm'),
    arrTime: dayjs(t.arrivalTime).format('HH:mm'),
    notes: t.notes ?? '',
  }
}

function TransitCard({
  transit, isEditing, rows, rowColor, onStartEdit, onSave, onCancel, onRemove,
}: {
  transit: TransitOption
  isEditing: boolean
  rows: { id: string; name: string }[]
  rowColor?: string
  onStartEdit: () => void
  onSave: (updates: Partial<TransitOption>) => boolean
  onCancel: () => void
  onRemove: () => void
}) {
  const [fields, setFields] = useState<EditFields>(() => fieldsFromTransit(transit))
  const [depErr, setDepErr] = useState(false)
  const [arrErr, setArrErr] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [saveError, setSaveError] = useState('')
  const cardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isEditing) {
      setFields(fieldsFromTransit(transit))
      setDepErr(false); setArrErr(false); setConfirmDelete(false)
      setSaveError('')
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  const buildAndSave = (f: EditFields) => {
    const dep = parseTimeStr(f.depTime), arr = parseTimeStr(f.arrTime)
    const invalidRange = Boolean(dep && arr && arr <= dep)
    setDepErr(!dep); setArrErr(!arr || invalidRange)
    if (!dep || !arr || invalidRange) return
    const departureTime = dayjs(`${f._date}T${dep}`).toISOString()
    const arrivalTime = dayjs(`${f._date}T${arr}`).toISOString()
    const finalName = f.name.trim() || `${TYPE_LABELS[f.type]} ${dayjs(departureTime).format('HH:mm')}`
    const saved = onSave({
      type: f.type, name: finalName,
      category: f.category || undefined,
      departureTime, arrivalTime,
      duration: dayjs(arrivalTime).diff(dayjs(departureTime), 'minute'),
      notes: f.notes.trim() || undefined,
    })
    setSaveError(saved ? '' : '该时间与计划中的事项重叠，请先调整事项。')
  }

  const handleCardBlur = (e: React.FocusEvent) => {
    if (cardRef.current && !cardRef.current.contains(e.relatedTarget as Node)) {
      if (!confirmDelete) buildAndSave(fields)
    }
  }

  const set = (key: keyof EditFields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFields(f => ({ ...f, [key]: e.target.value }))

  if (isEditing) {
    return (
      <div ref={cardRef} className={`transit-card type-${transit.type} editing`} onBlur={handleCardBlur} tabIndex={-1}
        style={rowColor ? { borderLeftColor: rowColor } : undefined}>
        <div className="card-edit-form">
          <div className="form-row">
            <select value={fields.type} onChange={set('type')}>
              {(['flight','train','bus','shuttle','custom'] as TransitType[]).map(t => (
                <option key={t} value={t}>{TYPE_EMOJI[t]} {TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input type="text" placeholder="班次名称（可选）" value={fields.name} onChange={set('name')} />
          </div>
          <div className="form-row">
            <select value={fields.category} onChange={set('category')}>
              {rows.length === 0 && <option value="">-- 无分类 --</option>}
              {rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-row time-row">
            <input type="text" placeholder="出发 08:00"
              value={fields.depTime} onChange={e => { setFields(f => ({...f, depTime: e.target.value})); setDepErr(false) }}
              className={depErr ? 'input-error' : ''} />
            <span className="time-sep">→</span>
            <input type="text" placeholder="到达 10:00"
              value={fields.arrTime} onChange={e => { setFields(f => ({...f, arrTime: e.target.value})); setArrErr(false) }}
              className={arrErr ? 'input-error' : ''} />
          </div>
          <div className="form-row">
            <input type="text" placeholder="备注（可选）" value={fields.notes} onChange={set('notes')} />
          </div>
          {saveError && <div className="form-error" role="status">{saveError}</div>}
          <div className="form-row card-edit-actions">
            <button type="button" className="btn-primary" onClick={() => buildAndSave(fields)}>保存</button>
            <button type="button" className="btn-text" onClick={onCancel}>取消</button>
            <span style={{ flex: 1 }} />
            {confirmDelete ? (
              <>
                <span className="delete-confirm-text">确认删除？</span>
                <button type="button" className="btn-danger-sm" onClick={onRemove}>确认</button>
                <button type="button" className="btn-text" onClick={() => setConfirmDelete(false)}>取消</button>
              </>
            ) : (
              <button type="button" className="btn-danger-sm" onClick={() => setConfirmDelete(true)}>删除</button>
            )}
          </div>
        </div>
      </div>
    )
  }

  const rowName = transit.category ? rows.find(r => r.id === transit.category)?.name : undefined

  return (
    <div className={`transit-card type-${transit.type}`} style={rowColor ? { borderLeftColor: rowColor } : undefined}>
      <span className="card-icon">{TYPE_EMOJI[transit.type]}</span>
      <div className="card-info">
        <div className="card-name">{transit.name || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>未命名</span>}</div>
        <div className="card-time">{dayjs(transit.departureTime).format('HH:mm')} → {dayjs(transit.arrivalTime).format('HH:mm')}</div>
        {rowName && <div className="card-category" style={rowColor ? { color: rowColor } : undefined}>{rowName}</div>}
        {transit.notes && <div className="card-notes">{transit.notes}</div>}
      </div>
      <button className="btn-icon" onClick={onStartEdit} title="编辑" aria-label="编辑">✎</button>
      <button className="btn-icon" onClick={onRemove} title="删除" aria-label="删除">✕</button>
    </div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

export default function TransitLibrary() {
  const {
    transitsMap, rows, addTransit, updateTransit, removeTransit,
    editingTransitId, setEditingTransitId,
    formPrefill, setFormPrefill,
  } = useTimelineStore(state => ({
    transitsMap: state.transits,
    rows: state.rows,
    addTransit: state.addTransit,
    updateTransit: state.updateTransit,
    removeTransit: state.removeTransit,
    editingTransitId: state.editingTransitId,
    setEditingTransitId: state.setEditingTransitId,
    formPrefill: state.formPrefill,
    setFormPrefill: state.setFormPrefill,
  }), shallow)

  const transits = useMemo(() => Array.from(transitsMap.values()), [transitsMap])

  const [filter, setFilter] = useState<string>(() => rows[0]?.id ?? 'all')
  const [showForm, setShowForm] = useState(true)
  const [editId, setEditId] = useState<string | null>(null)

  const [type, setType] = useState<TransitType>(() => (localStorage.getItem('lastTransitType') as TransitType) ?? 'flight')
  const [name, setName] = useState('')
  const [category, setCategory] = useState(() => rows[0]?.id ?? '')
  const [depRaw, setDepRaw] = useState('08:00')
  const [arrRaw, setArrRaw] = useState('10:00')
  const [notes, setNotes] = useState('')
  const [depErr, setDepErr] = useState(false)
  const [arrErr, setArrErr] = useState(false)

  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  const listRef = useRef<HTMLDivElement>(null)

  // Auto-select first row for category when rows become available
  useEffect(() => {
    if (rows.length > 0 && !category) setCategory(rows[0].id)
  }, [rows, category])

  // Auto-select first row for filter when rows first appear
  useEffect(() => {
    if (rows.length > 0 && filter === 'all') setFilter(rows[0].id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length])

  // Focus transit triggered from Gantt block click
  useEffect(() => {
    if (!editingTransitId) return
    const transit = transits.find(t => t.id === editingTransitId)
    setFilter(transit?.category ?? 'all')
    setEditId(editingTransitId)
    setEditingTransitId(null)
    if (transit) {
      setType(transit.type)
      localStorage.setItem('lastTransitType', transit.type)
      if (transit.category) setCategory(transit.category)
    }
    const id = editingTransitId
    setTimeout(() => {
      cardRefs.current.get(id)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }, 60)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTransitId])

  // (5) Scroll editing card to top of list
  useEffect(() => {
    if (!editId) return
    const cardEl = cardRefs.current.get(editId)
    if (!cardEl) return
    setTimeout(() => {
      cardEl.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 30)
  }, [editId])

  // Handle undo/redo form prefill
  useEffect(() => {
    if (!formPrefill) return
    setType(formPrefill.type)
    localStorage.setItem('lastTransitType', formPrefill.type)
    if (formPrefill.category) setCategory(formPrefill.category)
    setName(formPrefill.name)
    setDepRaw(dayjs(formPrefill.departureTime).format('HH:mm'))
    setArrRaw(dayjs(formPrefill.arrivalTime).format('HH:mm'))
    setNotes(formPrefill.notes ?? '')
    setShowForm(true)
    setFormPrefill(null)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formPrefill])

  const handleTypeChange = (t: TransitType) => {
    setType(t); localStorage.setItem('lastTransitType', t)
  }

  const handleStartEdit = (transit: TransitOption) => {
    setEditId(transit.id)
    setType(transit.type)
    localStorage.setItem('lastTransitType', transit.type)
    if (transit.category) setCategory(transit.category)
  }

  const filtered = useMemo(() => filter === 'all'
    ? [...transits].sort((a, b) => {
      const td = dayjs(a.departureTime).diff(dayjs(b.departureTime))
      return td !== 0 ? td : a.type.localeCompare(b.type)
    })
    : transits
      .filter(t => t.category === filter)
      .sort((a, b) => dayjs(a.departureTime).diff(dayjs(b.departureTime))), [filter, transits])

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault()
    const dep = parseTimeStr(depRaw), arr = parseTimeStr(arrRaw)
    const invalidRange = Boolean(dep && arr && arr <= dep)
    setDepErr(!dep); setArrErr(!arr || invalidRange)
    if (!dep || !arr || invalidRange) return
    const date = dayjs().format('YYYY-MM-DD')
    const departureTime = dayjs(`${date}T${dep}`).toISOString()
    const arrivalTime = dayjs(`${date}T${arr}`).toISOString()
    const finalName = name.trim() || `${TYPE_LABELS[type]} ${dayjs(departureTime).format('HH:mm')}`
    addTransit({
      id: `t-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      type, name: finalName, departureTime, arrivalTime,
      duration: dayjs(arrivalTime).diff(dayjs(departureTime), 'minute'),
      category: category || undefined,
      notes: notes.trim() || undefined,
    })
    setName(''); setNotes('')
    setDepErr(false); setArrErr(false)
  }

  return (
    <aside className="panel panel-library">
      <div className="panel-header">
        <h2>班次库 <span className="badge">{transits.length}</span></h2>
        <button className="btn-text" onClick={() => setShowForm(f => !f)}>{showForm ? '收起' : '＋ 添加'}</button>
      </div>

      {showForm && (
        <form className="add-form" onSubmit={handleAdd}>
          <div className="form-row">
            <select value={type} onChange={e => handleTypeChange(e.target.value as TransitType)}>
              {(['flight','train','bus','shuttle','custom'] as TransitType[]).map(t => (
                <option key={t} value={t}>{TYPE_EMOJI[t]} {TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <input type="text" placeholder="班次名称（可选，如 A1001）" value={name} onChange={e => setName(e.target.value)} />
          </div>
          <div className="form-row">
            <select value={category} onChange={e => setCategory(e.target.value)}>
              {rows.length === 0 && <option value="">-- 无分类 --</option>}
              {rows.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-row time-row">
            <input type="text" placeholder="08:00" value={depRaw}
              onChange={e => { setDepRaw(e.target.value); setDepErr(false) }}
              className={depErr ? 'input-error' : ''} />
            <span className="time-sep">→</span>
            <input type="text" placeholder="10:00" value={arrRaw}
              onChange={e => { setArrRaw(e.target.value); setArrErr(false) }}
              className={arrErr ? 'input-error' : ''} />
          </div>
          <div className="form-row">
            <input type="text" placeholder="备注（可选）" value={notes} onChange={e => setNotes(e.target.value)} />
          </div>
          <button type="submit" className="btn-primary">添加班次</button>
        </form>
      )}

      {/* Row-based filter chips, "全部" last */}
      <div className="filter-row">
        {rows.map((row, idx) => {
          const color = getRowColor(idx)
          const isActive = filter === row.id
          return (
            <button key={row.id} className="filter-chip-row"
              style={isActive
                ? { background: color, borderColor: color, color: '#fff' }
                : { borderColor: color, color }}
              onClick={() => setFilter(row.id)}
            >{row.name}</button>
          )
        })}
        <button
          className={`filter-chip${filter === 'all' ? ' active' : ''}`}
          onClick={() => setFilter('all')}
        >全部</button>
      </div>

      <div className="transit-list" ref={listRef}>
        {filtered.length === 0 ? (
          <p className="empty-hint">{transits.length === 0 ? '添加班次后将显示于此' : '该交通行暂无班次'}</p>
        ) : (
          filtered.map(transit => {
            const rowIdx = transit.category ? rows.findIndex(r => r.id === transit.category) : -1
            const rowColor = rowIdx >= 0 ? getRowColor(rowIdx) : undefined
            return (
              <div key={transit.id} ref={el => { if (el) cardRefs.current.set(transit.id, el); else cardRefs.current.delete(transit.id) }}>
                <TransitCard transit={transit} rows={rows} rowColor={rowColor}
                  isEditing={editId === transit.id}
                  onStartEdit={() => handleStartEdit(transit)}
                  onSave={updates => {
                    const saved = updateTransit(transit.id, updates)
                    if (saved) setEditId(null)
                    return saved
                  }}
                  onCancel={() => setEditId(null)}
                  onRemove={() => { if (editId === transit.id) setEditId(null); removeTransit(transit.id) }}
                />
              </div>
            )
          })
        )}
      </div>
    </aside>
  )
}
