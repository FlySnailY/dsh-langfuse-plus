/**
 * dsh-langfuse-plus client 半 —— DSH 侧栏 Langfuse 入口按钮。
 *
 * 注册到 sidebar.footer.action 插槽，wide 控制宽/窄侧栏显示（文字/仅图标）。
 * 零 DSH 运行时依赖：只注入 ctx.slots，不 import dsh-client-* 运行时代码
 * （type-only，构建时擦除）；仅 react/jsx-runtime 两个 external。
 */
import { useState, type CSSProperties } from 'react'

/** 跳转地址：build-client.mjs 构建期注入（DSH_LANGFUSE_BASE_URL / DSH_LANGFUSE_PROJECT_ID）。 */
declare const __LANGFUSE_URL__: string
const LANGFUSE_URL = __LANGFUSE_URL__

export const inject = ['slots']

/** 注册侧栏按钮，返回 slots disposer（卸载时摘除槽位）。 */
export function apply(ctx: any): () => void {
  return ctx.slots.register(
    {
      name: 'sidebar.footer.action',
      id: 'langfuse',
      order: 100,
    },
    LangfuseFooterAction,
  )
}

function LangfuseFooterAction(props: { wide: boolean }): JSX.Element {
  const [hovered, setHovered] = useState(false)

  const openLangfuse = (): void => {
    window.open(LANGFUSE_URL, '_blank', 'noopener,noreferrer')
  }

  const style: CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: props.wide ? 'flex-start' : 'center',
    gap: 8,
    width: '100%',
    padding: props.wide ? '6px 10px' : '6px 0',
    border: 'none',
    background: hovered ? 'rgba(127, 127, 127, 0.14)' : 'transparent',
    color: 'inherit',
    cursor: 'pointer',
    fontSize: 13,
    lineHeight: 1.4,
    borderRadius: 6,
    fontFamily: 'inherit',
  }

  return (
    <button
      type="button"
      onClick={openLangfuse}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={style}
      title="Open Langfuse"
      aria-label="Open Langfuse"
    >
      <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden="true" style={{ flexShrink: 0 }}>
        <path d="M8 1 L15 8 L8 15 L1 8 Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      </svg>
      {props.wide ? <span>Langfuse</span> : null}
    </button>
  )
}
