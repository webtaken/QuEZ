'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ChevronUp, ChevronDown, Trash2, Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { QuizQuestion } from '@/lib/quiz-schema'

interface QuestionEditorProps {
  question: QuizQuestion
  index: number
  total: number
  onChange: (next: QuizQuestion) => void
  onDelete: () => void
  onMoveUp: () => void
  onMoveDown: () => void
}

export function QuestionEditor({
  question,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: QuestionEditorProps) {
  const isTrueFalse = question.type === 'true_false'

  function setField<K extends keyof QuizQuestion>(key: K, value: QuizQuestion[K]) {
    onChange({ ...question, [key]: value })
  }

  function setType(nextType: QuizQuestion['type']) {
    if (nextType === 'true_false') {
      onChange({
        ...question,
        type: 'true_false',
        options: ['True', 'False'],
        correctIndex: question.correctIndex > 1 ? 0 : question.correctIndex,
      })
    } else {
      onChange({ ...question, type: 'multiple_choice' })
    }
  }

  function setOption(i: number, value: string) {
    const next = [...question.options]
    next[i] = value
    onChange({ ...question, options: next })
  }

  function addOption() {
    if (question.options.length >= 4 || isTrueFalse) return
    onChange({ ...question, options: [...question.options, ''] })
  }

  function removeOption(i: number) {
    if (question.options.length <= 2 || isTrueFalse) return
    const next = question.options.filter((_, idx) => idx !== i)
    let nextCorrect = question.correctIndex
    if (i === question.correctIndex) nextCorrect = 0
    else if (i < question.correctIndex) nextCorrect = question.correctIndex - 1
    onChange({ ...question, options: next, correctIndex: nextCorrect })
  }

  return (
    <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className="w-7 h-7 rounded-full bg-accent-lime/20 text-accent-lime text-xs font-bold flex items-center justify-center shrink-0">
          {index + 1}
        </span>
        <span className="text-xs text-muted-foreground">Question {index + 1}</span>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground"
            onClick={onMoveUp}
            disabled={index === 0}
            aria-label="Move up"
          >
            <ChevronUp className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground"
            onClick={onMoveDown}
            disabled={index === total - 1}
            aria-label="Move down"
          >
            <ChevronDown className="w-3.5 h-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="w-7 h-7 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label="Delete question"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>

      {/* Question text */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Question</label>
        <Textarea
          value={question.text}
          onChange={(e) => setField('text', e.target.value)}
          placeholder="Enter the question..."
          rows={2}
          className="resize-none"
        />
      </div>

      {/* Type + Time */}
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Type</label>
          <select
            value={question.type}
            onChange={(e) => setType(e.target.value as QuizQuestion['type'])}
            className="w-full h-9 rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          >
            <option value="multiple_choice">Multiple choice</option>
            <option value="true_false">True / False</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">Time limit (s)</label>
          <Input
            type="number"
            min={15}
            max={60}
            value={question.timeLimit}
            onChange={(e) => {
              const n = parseInt(e.target.value, 10)
              if (!Number.isNaN(n)) setField('timeLimit', n)
            }}
          />
        </div>
      </div>

      {/* Options */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="text-xs font-medium text-muted-foreground">
            Options (select correct)
          </label>
          {!isTrueFalse && (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={addOption}
              disabled={question.options.length >= 4}
            >
              <Plus className="w-3 h-3" />
              Add option
            </Button>
          )}
        </div>
        <div className="space-y-2">
          {question.options.map((opt, i) => (
            <div
              key={i}
              className={cn(
                'flex items-center gap-2 px-3 py-2 rounded-xl border',
                i === question.correctIndex
                  ? 'border-success/40 bg-success/5'
                  : 'border-border'
              )}
            >
              <input
                type="radio"
                name={`correct-${index}`}
                checked={i === question.correctIndex}
                onChange={() => setField('correctIndex', i)}
                className="w-4 h-4 accent-accent-lime shrink-0"
                aria-label={`Mark option ${String.fromCharCode(65 + i)} as correct`}
              />
              <span className="text-xs font-bold text-muted-foreground w-4 shrink-0">
                {String.fromCharCode(65 + i)}
              </span>
              <Input
                value={opt}
                onChange={(e) => setOption(i, e.target.value)}
                placeholder={`Option ${String.fromCharCode(65 + i)}`}
                disabled={isTrueFalse}
                className="border-0 bg-transparent shadow-none focus-visible:ring-0 px-1"
              />
              {!isTrueFalse && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="w-7 h-7 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => removeOption(i)}
                  disabled={question.options.length <= 2}
                  aria-label="Remove option"
                >
                  <X className="w-3.5 h-3.5" />
                </Button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Explanation */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground">Explanation</label>
        <Textarea
          value={question.explanation}
          onChange={(e) => setField('explanation', e.target.value)}
          placeholder="Why is the correct answer correct?"
          rows={2}
          className="resize-none"
        />
      </div>
    </div>
  )
}
