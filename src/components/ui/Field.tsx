import { Children, cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react'

interface FieldProps {
  label: string
  className?: string
  children: ReactNode
}

const FORM_CONTROL_TAGS = new Set(['input', 'select', 'textarea'])

// Walks the DOM-element subtree under a Field's children (never into custom
// components — Field only ever wraps native controls, see the
// form-field-label-wrapping-gotcha memory) and stamps an id/name onto the
// first input/select/textarea it finds, so every Field gets one automatically
// instead of relying on each call site to pass one.
function withGeneratedId(node: ReactNode, id: string, assigned: { done: boolean }): ReactNode {
  if (assigned.done || !isValidElement(node) || typeof node.type !== 'string') return node

  const element = node as ReactElement<{ id?: string; name?: string; children?: ReactNode }>

  if (FORM_CONTROL_TAGS.has(element.type as string)) {
    assigned.done = true
    const fieldId = element.props.id ?? id
    return cloneElement(element, {
      id: fieldId,
      name: element.props.name ?? fieldId,
    })
  }

  const { children } = element.props
  if (children == null) return node

  return cloneElement(element, {
    children: Children.map(children, (child) => withGeneratedId(child, id, assigned)),
  })
}

export function Field({ label, className = '', children }: FieldProps) {
  const generatedId = useId()
  const assigned = { done: false }
  const taggedChildren = Children.map(children, (child) => withGeneratedId(child, generatedId, assigned))

  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      {taggedChildren}
    </label>
  )
}
