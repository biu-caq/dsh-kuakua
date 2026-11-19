/**
 * dsh-kuakua — Client half.
 *
 * 三块面：
 *   1. 输入框里的两枚按钮（夸夸 / 表情包）；
 *   2. 表情包轻量面板（点图进输入框，递不进去只提示、不写文字）；
 *   3. 设置页（settings.section + 左上角面板入口）。
 *
 * 配置与图片都从 host 半边（/x-kuakua）取，这里不落盘。
 */
window.__ModuleLoader__.load({
  id: 'dsh-kuakua',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const ReactDOM = (() => { try { return require('react-dom') } catch { return null } })()

    const API = '/x-kuakua'
    const SECTION_ID = 'dsh-kuakua'
    const REPEAT_KEY = 'dsh-kuakua:repeat-mode'

    /** 连点夸夸时：append=继续加一条，replace=换掉上一条。存本地，host 支持后以配置为准。 */
    function readRepeatMode() {
      try {
        return window.localStorage.getItem(REPEAT_KEY) === 'replace' ? 'replace' : 'append'
      } catch (ignored) {
        return 'append'
      }
    }

    function writeRepeatMode(value) {
      try { window.localStorage.setItem(REPEAT_KEY, value === 'replace' ? 'replace' : 'append') } catch (ignored) { /* noop */ }
    }
    const IMAGE_LIMIT = 4 * 1024 * 1024

    /* ================================================================
     * 共享状态：配置 + 表情清单
     * ================================================================ */

    const store = {
      state: { config: null, dir: '', defaultDir: '', stickers: [], loading: true, error: null },
      subs: new Set(),
    }

    function emit() {
      for (const fn of store.subs) {
        try { fn() } catch (ignored) { /* 一个订阅炸了不拖累其它 */ }
      }
    }

    function patch(next) {
      store.state = { ...store.state, ...next }
      emit()
    }

    let inflight = null
    function refresh() {
      if (inflight) return inflight
      inflight = (async () => {
        try {
          const res = await fetch(`${API}/state`, { cache: 'no-store' })
          const data = await res.json()
          if (!data || data.ok === false) throw new Error((data && data.error) || '读取失败')
          patch({
            config: data.config,
            dir: data.dir,
            defaultDir: data.defaultDir || '',
            stickers: Array.isArray(data.stickers) ? data.stickers : [],
            error: data.error || null,
            loading: false,
          })
        } catch (error) {
          patch({ loading: false, error: String((error && error.message) || error) })
        } finally {
          inflight = null
        }
      })()
      return inflight
    }

    async function saveConfig(patchValue) {
      const res = await fetch(`${API}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patchValue),
      })
      const data = await res.json()
      if (!data || data.ok === false) throw new Error((data && data.error) || '保存失败')
      patch({
        config: data.config,
        dir: data.dir,
        stickers: Array.isArray(data.stickers) ? data.stickers : store.state.stickers,
        error: data.error || null,
      })
      return data
    }

    function useSelector(selector) {
      const read = () => selector(store.state)
      return React.useSyncExternalStore(
        (cb) => { store.subs.add(cb); return () => store.subs.delete(cb) },
        read,
        read,
      )
    }

    /* ================================================================
     * 拼句子
     * ================================================================ */

    function pick(list) {
      if (!Array.isArray(list) || list.length === 0) return ''
      return list[Math.floor(Math.random() * list.length)]
    }

    /** 括号里空了就整对拿掉；表是空的，句子里留下的空位和重复标点也顺手收拾掉。 */
    function tidy(text) {
      return String(text || '')
        .replace(/[（(]\s*[）)]/g, '')
        .replace(/【\s*】/g, '')
        .replace(/\[\s*\]/g, '')
        .replace(/\s{2,}/g, ' ')
        .replace(/\s+([，。！？、；：])/g, '$1')
        .replace(/([，。！？、；：])\s+/g, '$1')
        .replace(/([，。！？、；：])\1+/g, '$1')
        .replace(/^[，。！？、；：\s]+/u, '')
        .trim()
    }

    function fill(template, config) {
      const map = {
        '称呼': pick(config.addresses),
        '夸奖': pick(config.praises),
        '动作': pick(config.actions),
        '颜文字': pick(config.kaomoji),
        'emoji': pick(config.emojis),
      }
      let out = String(template || '')
      out = out
        .replace(/\{(称呼|夸奖|动作|颜文字|emoji)\}/g, (_all, key) => map[key] ?? '')
        .replace(/\{[a-zA-Z]+\}/g, '')
      return tidy(out)
    }

    function compose(config) {
      if (!config) return ''
      if (config.mode === 'template') {
        const template = pick(config.templates)
        if (template) return fill(template, config)
      }
      if (config.expression && config.expression.trim()) return fill(config.expression, config)
      return fill('{称呼}{夸奖}', config)
    }

    /* ================================================================
     * 样式
     * ================================================================ */

    const STYLE_ID = 'dsh-kuakua-style'
    const CSS = `
.kq-bar{display:flex;align-items:center;gap:4px}
.kq-btn{border:1px solid transparent;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:13px;line-height:1;padding:0 6px;height:28px;display:inline-flex;align-items:center;justify-content:center;gap:5px;cursor:pointer;transition:background .15s,color .15s,box-shadow .15s,border-color .15s}
.kq-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l1);box-shadow:0 1px 3px rgba(0,0,0,.10)}
.kq-btn.is-icon{width:28px;padding:0}
.kq-btn svg{display:block;flex:none}
.kq-btn:active{transform:scale(.94)}
.kq-btn[aria-pressed="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kq-panel{position:fixed;z-index:61;box-sizing:border-box;width:min(430px,92vw);max-height:min(46vh,520px);display:flex;flex-direction:column;gap:8px;padding:12px;border-radius:14px;background:var(--dsw-alias-bg-overlay,#fff);border:1px solid var(--dsw-alias-border-l1);box-shadow:0 14px 44px rgba(0,0,0,.3);font-size:12px;color:var(--dsw-alias-label-primary)}
.kq-panel-head{display:flex;align-items:center;gap:8px}
.kq-panel-title{font-weight:600;font-size:13px;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kq-mini{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);border-radius:8px;font-size:11px;padding:3px 7px;cursor:pointer}
.kq-mini:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}
.kq-grid{display:grid;grid-template-columns:repeat(var(--kq-cols,6),1fr);gap:6px;overflow-y:auto;overflow-x:hidden;padding:0;scrollbar-gutter:stable}
.kq-cell{position:relative;aspect-ratio:1;border:1px solid transparent;border-radius:10px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.05));padding:0;cursor:pointer;overflow:hidden;display:flex;align-items:center;justify-content:center}
.kq-cell:hover{border-color:var(--dsw-alias-brand-primary)}
.kq-cell img{max-width:100%;max-height:100%;object-fit:contain;pointer-events:none}
.kq-cell span{position:absolute;left:0;right:0;bottom:0;padding:2px 3px;font-size:9px;line-height:1.2;background:rgba(0,0,0,.55);color:#fff;opacity:0;transition:opacity .12s;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.kq-cell:hover span{opacity:1}
.kq-empty{padding:16px 10px;text-align:center;color:var(--dsw-alias-label-secondary);line-height:1.7}
.kq-page{display:flex;flex-direction:column;gap:16px;padding:4px;max-width:760px}
.kq-row{display:flex;flex-direction:column;gap:6px}
.kq-row-title{font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary)}
.kq-row-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.kq-input,.kq-area{width:100%;box-sizing:border-box;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;padding:7px 9px;font-family:inherit}
.kq-area{min-height:66px;resize:vertical;line-height:1.6}
.kq-input:focus,.kq-area:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.kq-choices{display:flex;gap:8px;flex-wrap:wrap}
.kq-choice{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:6px 10px;font-size:12px;cursor:pointer;background:var(--dsw-alias-bg-layer-1)}
.kq-choice[aria-checked="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.kq-vars{display:flex;gap:6px;flex-wrap:wrap}
.kq-var{font-size:11px;padding:2px 6px;border-radius:6px;background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.06));color:var(--dsw-alias-label-secondary);cursor:pointer;border:1px solid var(--dsw-alias-border-l1)}
.kq-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.kq-primary{border:1px solid var(--dsw-alias-brand-primary);background:var(--dsw-alias-brand-primary);color:#fff;border-radius:9px;font-size:12px;padding:7px 14px;cursor:pointer}
.kq-plain{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;font-size:12px;padding:7px 12px;cursor:pointer}
.kq-plain:hover{border-color:var(--dsw-alias-border-l2)}
.kq-note{font-size:11px;color:var(--dsw-alias-label-secondary)}
.kq-note.is-error{color:var(--dsw-alias-state-error-primary)}
.kq-note.is-ok{color:var(--dsw-alias-state-success-primary)}
.kq-main{height:100%;overflow:auto;padding:28px 32px 48px;box-sizing:border-box;color:var(--dsw-alias-label-primary)}
.kq-main-head{margin-bottom:18px}
.kq-main-title{font-size:18px;font-weight:600;margin:0 0 4px}
.kq-main-sub{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}
`

    /** 样式跟着组件走：挂载时在，卸载时一起走，不怕热更新把 head 里那份删掉。 */
    function StyleTag() {
      return h('style', { 'data-dsh-kuakua': '' }, CSS)
    }

    // 只留布局兜底；颜色/底色/边框都交给样式表，悬停时才能变色（内联样式会盖掉 :hover）
    const BTN_BASE = {
      height: '28px',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: '5px',
      fontSize: '13px',
      lineHeight: 1,
      cursor: 'pointer',
    }
    const BTN_TEXT = { ...BTN_BASE, padding: '0 6px' }
    const BTN_ICON = { ...BTN_BASE, width: '28px', padding: 0 }

    /** 线条图标：只描边、不填色，跟宿主那排图标一个调子。 */
    function LineIcon(props, ...children) {
      return h('svg', {
        viewBox: '0 0 24 24',
        width: props && props.size ? props.size : 16,
        height: props && props.size ? props.size : 16,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.6,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      }, ...children)
    }

    /** 夸夸图标：袖口（带扣子）+ 竖大拇指 + 右上角一颗心，整体歪 10°。按钮和侧栏共用。 */
    function PraiseGlyph(props) {
      const size = props && Number.isFinite(props.size) ? props.size : 16
      return h('svg', {
        viewBox: '0 0 24 24',
        width: size,
        height: size,
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 1.25,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
        'aria-hidden': 'true',
      },
        h('g', { key: 'g', transform: 'rotate(-10 12 12)' },
          // 手（缩窄了一点，线宽乘回去，视觉上还是 1.25）
          h('path', {
            key: 'hand',
            transform: 'translate(1.45 1.7) scale(0.8 0.88)',
            strokeWidth: 1.55,
            d: 'M7.6 17.9h6.6a2.8 2.8 0 0 0 2.7-2.05l1-3.8a2.05 2.05 0 0 0-1.95-2.6h-3.05l.45-2.4a1.95 1.95 0 0 0-1.85-2.3c-.75 0-1.4.45-1.7 1.1l-1.75 4.35H7.6',
          }),
          // 爱心
          h('path', {
            key: 'heart',
            d: 'M16.4 8.2C15.1 7.2 14.4 6.5 14.4 5.7C14.4 4.9 15.1 4.5 15.8 4.7C16.15 4.8 16.3 5.05 16.4 5.3C16.5 5.05 16.65 4.8 17 4.7C17.7 4.5 18.4 4.9 18.4 5.7C18.4 6.5 17.7 7.2 16.4 8.2Z',
          }),
          // 袖口 + 扣子
          h('rect', { key: 'cuff', x: 1.6, y: 8.8, width: 5.6, height: 10, rx: 1.3 }),
          h('circle', { key: 'button', cx: 3.8, cy: 16.6, r: 0.85, fill: 'currentColor', stroke: 'none' }),
        ),
      )
    }

    function IconSticker() {
      return LineIcon({ size: 18 },
        h('circle', { key: 'a', cx: 12, cy: 12, r: 8.6 }),
        h('circle', { key: 'b', cx: 9.2, cy: 10.1, r: 0.95, fill: 'currentColor', stroke: 'none' }),
        h('circle', { key: 'c', cx: 14.8, cy: 10.1, r: 0.95, fill: 'currentColor', stroke: 'none' }),
        h('path', { key: 'd', d: 'M8.5 13.8c.9 1.4 2.1 2.1 3.5 2.1s2.6-.7 3.5-2.1' }),
      )
    }

    const PANEL_BOX = {
      position: 'fixed',
      zIndex: 2147482001,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      padding: '12px',
      borderRadius: '14px',
      background: 'var(--dsw-alias-bg-overlay, #ffffff)',
      border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.18))',
      boxShadow: '0 14px 44px rgba(0,0,0,.3)',
      boxSizing: 'border-box',
      overflow: 'hidden',
      color: 'var(--dsw-alias-label-primary, #222)',
      fontSize: '12px',
    }

    /* ================================================================
     * 小工具
     * ================================================================ */

    /** 宿主给的是 hook（useSyncExternalStore），只能在渲染里读一次，别塞进事件回调里调。 */
    function useInputState(props) {
      const hook = props && typeof props.useInput === 'function' ? props.useInput : null
      // hook 数量必须稳定：同一个组件实例上 props.useInput 不会变，所以这里安全。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return hook ? hook((s) => s) : null
    }

    /** 当前会话是否正在跑一轮；跑着的时候输入栏不收附件。 */
    function useRunning(props) {
      const hook = props && typeof props.useSession === 'function' ? props.useSession : null
      // hook 数量必须稳定：同一个组件实例上 props.useSession 不会变。
      // eslint-disable-next-line react-hooks/rules-of-hooks
      return hook ? hook((s) => !!(s && s.running)) : false
    }

    function attachmentCount(state) {
      return state && Array.isArray(state.attachmentIds) ? state.attachmentIds.length : 0
    }

    function composerCard() {
      try {
        return document.querySelector('[data-composer-card]') || document.body
      } catch (ignored) {
        return document.body
      }
    }

    /** 输入栏没把 addFiles 发给子槽，只能借它自己的粘贴 / 拖放通道把图递进去。 */
    function pasteFile(file) {
      try {
        const data = new DataTransfer()
        data.items.add(file)
        const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true })
        composerCard().dispatchEvent(event)
        return true
      } catch (error) {
        return false
      }
    }

    function dropFile(file) {
      try {
        const data = new DataTransfer()
        data.items.add(file)
        const card = composerCard()
        for (const type of ['dragenter', 'dragover', 'drop']) {
          card.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
        }
        return true
      } catch (error) {
        return false
      }
    }

    /** 图名多半是 1790141446372_550 这种编号；没有像人写的字就别往外贴。 */
    function displayName(item) {
      const base = String((item && item.base) || '')
      return /[^\d_\-\s]/u.test(base) ? base : ''
    }

    function sleep(ms) {
      return new Promise((resolve) => { window.setTimeout(resolve, ms) })
    }

    /* ================================================================
     * 表情包面板
     * ================================================================ */

    function StickerPanel(props) {
      const { anchor, config, onClose, onPick, onReveal, status } = props
      const stickers = useSelector((s) => s.stickers)
      const dir = useSelector((s) => s.dir)
      const error = useSelector((s) => s.error)
      const [rect, setRect] = React.useState(anchor)
      const gridRef = React.useRef(null)
      const scrollRef = React.useRef(0)

      React.useEffect(() => {
        const el = gridRef.current
        if (el && scrollRef.current > 0) el.scrollTop = scrollRef.current
      }, [stickers.length])

      React.useLayoutEffect(() => {
        setRect(anchor || null)
      }, [anchor])

      React.useEffect(() => {
        void refresh()
      }, [])

      React.useEffect(() => {
        const onKey = (event) => { if (event.key === 'Escape') onClose() }
        const onDown = (event) => {
          const target = event.target
          if (target && target.closest && (target.closest('.kq-panel') || target.closest('.kq-bar') || target.closest('.kq-menu'))) return
          onClose()
        }
        document.addEventListener('keydown', onKey)
        document.addEventListener('pointerdown', onDown, true)
        return () => {
          document.removeEventListener('keydown', onKey)
          document.removeEventListener('pointerdown', onDown, true)
        }
      }, [onClose])

      // 宽度由格子反推：固定 6 列 + 间隔，面板宽度跟着走，永远不会横向滚动
      const columns = Math.max(3, Math.min(10, Number(config && config.stickerColumns) || 6))
      const GAP = 6
      const PAD = 12
      const MAX_CELL = 62
      const GUTTER = 12 // 给纵向滚动条留的位置，不然最后一列会被压掉
      const fullCells = MAX_CELL * columns + GAP * (columns - 1)
      const avail = Math.min(fullCells, Math.floor(window.innerWidth * 0.92) - PAD * 2 - GUTTER)
      const cell = Math.max(34, Math.floor((avail - GAP * (columns - 1)) / columns))
      const width = cell * columns + GAP * (columns - 1) + GUTTER + PAD * 2
      const gridH = cell * 4 + GAP * 3
      let left = 8
      if (rect) left = Math.min(Math.max(8, rect.left - 6), Math.max(8, window.innerWidth - width - 8))
      // 底边贴输入框：面板底 = 输入框顶 - 8
      const card = composerCard()
      const cardTop = card && card.getBoundingClientRect ? card.getBoundingClientRect().top : window.innerHeight - 120
      const bottom = Math.max(8, window.innerHeight - cardTop + 8)

      const body = h('div', {
        className: 'kq-panel',
        style: { ...PANEL_BOX, left: `${left}px`, bottom: `${bottom}px`, width: `${width}px` },
        role: 'dialog',
        'aria-label': '表情包',
      },
        h(StyleTag, { key: 'kq-css' }),
        h('div', { className: 'kq-panel-head' },
          h('span', { className: 'kq-panel-title', title: dir }, `表情包 · ${stickers.length} 张`),
          h('button', { type: 'button', className: 'kq-mini', onClick: onReveal, title: dir || '' }, '打开文件夹'),
          h('button', { type: 'button', className: 'kq-mini', onClick: () => { void refresh() } }, '刷新'),
          h('button', { type: 'button', className: 'kq-mini', onClick: onClose }, '关闭'),
        ),
        error ? h('div', { className: 'kq-note is-error' }, error) : null,
        stickers.length === 0
          ? h('div', { className: 'kq-empty' },
              '这个文件夹里还没有图。',
              h('br'),
              '把 png / jpg / gif / webp 丢进去，点「刷新」就出现。')
          : h('div', {
              className: 'kq-grid',
              ref: gridRef,
              onScroll: (event) => { scrollRef.current = event.currentTarget.scrollTop },
              style: { '--kq-cols': String(columns), gridTemplateColumns: `repeat(${columns}, ${cell}px)`, gridAutoRows: `${cell}px`, height: `${gridH}px`, gap: `${GAP}px`, overflowX: 'hidden', scrollbarGutter: 'stable' },
            },
              stickers.map((item) => h('button', {
                key: item.name,
                type: 'button',
                className: 'kq-cell',
                title: `${item.pinned ? '📌 ' : ''}${item.name} · ${(item.size / 1024).toFixed(0)} KB`,
                onClick: () => onPick(item),
                onContextMenu: (event) => {
                  event.preventDefault()
                  event.stopPropagation()
                  if (typeof props.onCellMenu === 'function') props.onCellMenu(item, event)
                },
              },
                h('img', { src: item.url, alt: item.base, loading: 'lazy', draggable: 'false' }),
                h('span', null, item.base),
              ))),
      )

      if (!ReactDOM || typeof ReactDOM.createPortal !== 'function') return body
      return ReactDOM.createPortal(body, document.body)
    }

    /* ================================================================
     * 输入框上的按钮
     * ================================================================ */

    /** 点完按钮把焦点还给输入框，不然回车会再触发一次按钮。 */
    function keepComposerFocus(event) {
      try {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
      } catch (ignored) { /* noop */ }
      try {
        const card = document.querySelector('[data-composer-card]')
        const editor = card && card.querySelector('[contenteditable="true"], textarea')
        if (editor && typeof editor.focus === 'function') editor.focus({ preventScroll: true })
      } catch (ignored) { /* noop */ }
    }

    function KuakuBar(props) {
      const config = useSelector((s) => s.config)
      const [panel, setPanel] = React.useState(false)
      const [status, setStatus] = React.useState('')
      const barRef = React.useRef(null)

      React.useEffect(() => { void refresh() }, [])

      const inputState = useInputState(props)
      const running = useRunning(props)
      const stateRef = React.useRef(inputState)
      React.useEffect(() => { stateRef.current = inputState }, [inputState])
      const draftText = inputState && typeof inputState.draft === 'string' ? inputState.draft : ''

      const lastPhraseRef = React.useRef('')
      const [menu, setMenu] = React.useState(null)

      const openMenu = (x, y, items) => setMenu({ x, y, items })

      const closeMenu = () => setMenu(null)

      // 对话里的图片：右键可以收进表情包
      React.useEffect(() => {
        const onContext = (event) => {
          const target = event.target
          let img = target instanceof HTMLImageElement
            ? target
            : (target && typeof target.closest === 'function' ? target.closest('img') : null)
          if (!img && typeof event.composedPath === 'function') {
            img = event.composedPath().find((node) => node instanceof HTMLImageElement) || null
          }
          if (!img) return
          if (img.closest('.kq-panel') || img.closest('.kq-menu')) return
          const src = img.currentSrc || img.src
          if (!src) return
          event.preventDefault()
          openMenu(event.clientX, event.clientY, [{
            label: '添加到表情包',
            run: () => { void addChatImage(src) },
          }])
        }
        document.addEventListener('contextmenu', onContext, true)
        return () => document.removeEventListener('contextmenu', onContext, true)
      }, [])

      // 点别处 / Esc 关菜单
      React.useEffect(() => {
        if (!menu) return
        const onDown = (event) => {
          if (event.target && event.target.closest && event.target.closest('.kq-menu')) return
          closeMenu()
        }
        const onKey = (event) => { if (event.key === 'Escape') closeMenu() }
        document.addEventListener('pointerdown', onDown, true)
        document.addEventListener('keydown', onKey)
        return () => {
          document.removeEventListener('pointerdown', onDown, true)
          document.removeEventListener('keydown', onKey)
        }
      }, [menu])

      const refreshAndClose = async () => {
        closeMenu()
        await refresh()
      }

      const togglePin = async (item) => {
        await fetch(`${API}/stickers/pin`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.name, pinned: !item.pinned }),
        }).catch(() => null)
        await refreshAndClose()
      }

      const removeSticker = async (item) => {
        closeMenu()
        await fetch(`${API}/stickers/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.name }),
        }).catch(() => null)
        await refresh()
      }

      const addChatImage = async (src) => {
        closeMenu()
        try {
          const res = await fetch(src)
          const blob = await res.blob()
          if (!blob.type.startsWith('image/')) throw new Error('这不是图片')
          const data = await new Promise((resolve, reject) => {
            const reader = new FileReader()
            reader.onload = () => resolve(String(reader.result))
            reader.onerror = () => reject(new Error('读不出图片数据'))
            reader.readAsDataURL(blob)
          })
          const saved = await fetch(`${API}/stickers/add`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ data }),
          }).then((response) => response.json())
          if (!saved || saved.ok === false) throw new Error((saved && saved.error) || '保存失败')
          await refresh()
          setStatus(`已收进表情包：${saved.name}`)
        } catch (error) {
          setStatus(`收进表情包失败：${(error && error.message) || error}`)
        }
      }

      const insertLine = React.useCallback((line, cfg) => {
        const text = String(line || '').trim()
        if (!text) return
        const actions = props.inputActions
        if (!actions || typeof actions.setDraft !== 'function') {
          setStatus('拿不到输入框')
          return
        }
        const replaceMode = ((cfg && cfg.repeatMode) || readRepeatMode()) === 'replace'
        const previous = lastPhraseRef.current
        try {
          // 换掉上一条：只替上一句夸夸，用户自己打的字原样留着
          if (replaceMode && previous && previous !== text && draftText.includes(previous)) {
            actions.setDraft(draftText.replace(previous, text))
            lastPhraseRef.current = text
            setStatus('已换掉上一条')
            return
          }
          const trimEnd = draftText.replace(/\s+$/u, '')
          actions.setDraft(trimEnd ? `${trimEnd}\n${text}` : text)
          lastPhraseRef.current = text
          setStatus('已放进输入框')
        } catch (error) {
          setStatus(`写入失败：${(error && error.message) || error}`)
        }
      }, [props, draftText])

      const sendSticker = React.useCallback(async (item) => {
        const label = displayName(item)
        // 跑一轮的时候输入栏拒收附件（它自己的规矩），别让人干等。
        if (running) {
          setStatus('这一轮还在跑，图片暂时收不了，等它跑完再点')
          return
        }
        const stateNow = () => stateRef.current
        try {
          setStatus('处理中…')
          const res = await fetch(item.url, { cache: 'no-store' })
          const blob = await res.blob()
          if (blob.size > IMAGE_LIMIT) {
            setStatus(`${item.name} 太大（${(blob.size / 1048576).toFixed(1)}MB），没法附图`)
            return
          }
          const file = new File([blob], item.name, { type: blob.type || 'image/png' })
          const before = attachmentCount(stateNow())

          const add = props.addFiles
          if (typeof add === 'function') {
            const rejection = add([file])
            if (!rejection) {
              setStatus(`已放进输入框${label ? `：${label}` : ''}`)
              setPanel(false)
              return
            }
            setStatus(`输入框拒收（${rejection}）`)
            return
          }

          // 子槽拿不到 addFiles，只能借输入栏自己的通道：先试粘贴，不成就试拖放。
          const probe = async (name, attempt) => {
            let made = false
            try { made = attempt() === true } catch (ignored) { made = false }
            const deadline = Date.now() + 900
            while (Date.now() < deadline) {
              await sleep(80)
              if (attachmentCount(stateNow()) > before) return { ok: true, made, name }
            }
            return { ok: false, made, name }
          }
          const pasteResult = await probe('粘贴', () => pasteFile(file))
          let result = pasteResult
          if (!result.ok) result = await probe('拖放', () => dropFile(file))
          const after = attachmentCount(stateNow())
          try {
            window.__dshKuakua = { at: Date.now(), item: item.name, before, after, paste: pasteResult, last: result }
          } catch (ignored) { /* noop */ }
          if (result.ok) {
            setStatus(`已放进输入框${label ? `：${label}` : ''}`)
            setPanel(false)
            return
          }
          setStatus(`没递进去（${result.name}${result.made ? '发出去了但' : '没发出去'}，附件 ${before}→${after}）`)
        } catch (error) {
          setStatus(`取图失败：${(error && error.message) || error}`)
        }
      }, [props, running])

      const revealDir = React.useCallback(async () => {
        try {
          const res = await fetch(`${API}/reveal`, { method: 'POST' })
          const data = await res.json()
          if (!data || data.ok === false) throw new Error((data && data.error) || '打不开')
          setStatus(`已打开：${data.dir}`)
        } catch (error) {
          setStatus(`打不开目录：${(error && error.message) || error}`)
        }
      }, [])

      const anchorOf = () => {
        const el = barRef.current
        if (!el) return null
        const rect = el.getBoundingClientRect()
        return { left: rect.left, top: rect.top, bottom: rect.bottom, right: rect.right }
      }

      const menuNode = menu && ReactDOM && typeof ReactDOM.createPortal === 'function'
        ? ReactDOM.createPortal(h('div', {
            className: 'kq-menu',
            style: {
              position: 'fixed',
              zIndex: 2147483000,
              left: `${Math.min(menu.x, window.innerWidth - 152)}px`,
              top: `${Math.min(menu.y, window.innerHeight - 92)}px`,
              minWidth: '128px',
              padding: '4px',
              borderRadius: '10px',
              background: 'var(--dsw-alias-bg-overlay, #fff)',
              border: '1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.15))',
              boxShadow: '0 10px 30px rgba(0,0,0,.22)',
              display: 'flex',
              flexDirection: 'column',
              gap: '2px',
            },
          }, menu.items.map((entry, index) => h('button', {
            key: index,
            type: 'button',
            onMouseDown: (event) => event.preventDefault(),
            onClick: () => { entry.run() },
            style: {
              border: 'none',
              background: 'transparent',
              color: entry.tone === 'danger'
                ? 'var(--dsw-alias-state-error-primary, #d33)'
                : 'var(--dsw-alias-label-primary, #222)',
              fontSize: '12px',
              textAlign: 'left',
              padding: '6px 10px',
              borderRadius: '6px',
              cursor: 'pointer',
            },
          }, entry.label))), document.body)
        : null

      return h(React.Fragment, null,
        h(StyleTag, { key: 'kq-css' }),
        menuNode,
        h('div', { ref: barRef, className: 'kq-bar' },
          h('button', {
            key: 'kuaku',
            type: 'button',
            className: 'kq-btn',
            style: BTN_TEXT,
            title: '一键夸夸：拼一句放进输入框',
            'aria-label': '一键夸夸',
            onMouseDown: keepComposerFocus,
            onClick: () => insertLine(compose(config), config),
          }, h(PraiseGlyph, { size: 18 }), h('span', null, '夸夸')),
          h('button', {
            key: 'sticker',
            type: 'button',
            className: 'kq-btn is-icon',
            style: BTN_ICON,
            title: '表情包',
            'aria-label': '表情包',
            'aria-pressed': panel ? 'true' : 'false',
            onMouseDown: keepComposerFocus,
            onClick: () => { void refresh(); setPanel((open) => !open) },
          }, h(IconSticker, null)),
        ),
        panel
          ? h(StickerPanel, {
              anchor: anchorOf(),
              config,
              status,
              onCellMenu: (item, event) => openMenu(event.clientX, event.clientY, [
                { label: item.pinned ? '取消置顶' : '置顶', run: () => { void togglePin(item) } },
                { label: '删除', tone: 'danger', run: () => { void removeSticker(item) } },
              ]),
              onClose: () => setPanel(false),
              onPick: (item) => { void sendSticker(item) },
              onReveal: () => { void revealDir() },
            })
          : null,
      )
    }

    /* ---------------------------------------------------------------
     * 生成提示词：模板在页面这边，名字和特点存本地
     * --------------------------------------------------------------- */

    /* ================================================================
     * 设置页
     * ================================================================ */

    const LIST_FIELDS = [
      { key: 'addresses', label: '称呼', hint: '每行一个，夸的时候随机挑一个；留空就不出这一段。默认空着，自己填。' },
      { key: 'praises', label: '夸奖词', hint: '每行一句。要具体，能夸到点上，比空泛的「真棒」值钱。' },
      { key: 'actions', label: '动作描写', hint: '每行一个，会放进括号里；留空就不出这一段。默认空着，自己填。' },
      { key: 'kaomoji', label: '颜文字', hint: '每行一个，可留空。' },
      { key: 'emojis', label: 'emoji', hint: '每行一个，可留空。' },
    ]

    const VARS = ['{称呼}', '{夸奖}', '{动作}', '{颜文字}', '{emoji}']

    function toText(list) {
      return Array.isArray(list) ? list.join('\n') : ''
    }

    function toList(text) {
      return String(text || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    }

    function KuakuSettings() {
      const config = useSelector((s) => s.config)
      const stickers = useSelector((s) => s.stickers)
      const [draft, setDraft] = React.useState(null)
      const [raw, setRaw] = React.useState(null)
      const [note, setNote] = React.useState({ text: '', tone: '' })
      const [preview, setPreview] = React.useState('')
      const [dirText, setDirText] = React.useState('')
      const [qqSources, setQqSources] = React.useState([])
      const [qqSelected, setQqSelected] = React.useState([])
      const [qqDir, setQqDir] = React.useState('')
      const [qqNote, setQqNote] = React.useState('')
      const [qqBusy, setQqBusy] = React.useState(false)
      const [qqPreview, setQqPreview] = React.useState([])

      React.useEffect(() => { void refresh() }, [])

      React.useEffect(() => {
        if (!config) return
        setDraft({ ...config })
        const next = {}
        for (const field of LIST_FIELDS) next[field.key] = toText(config[field.key])
        next.templates = toText(config.templates)
        setRaw(next)
      }, [config])

      React.useEffect(() => {
        if (config) setDirText(config.stickersDir || '')
      }, [config])

      if (!draft || !raw) return h('div', { className: 'kq-page' }, h(StyleTag, { key: 'kq-css' }), h('p', { className: 'kq-note' }, '读取配置…'))

      const set = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }))
      const setRawField = (key, value) => setRaw((prev) => ({ ...prev, [key]: value }))

      /** 把「原文」折成要落盘的数组；空白行在这一步才丢掉。 */
      const collect = () => {
        const next = { ...draft }
        for (const field of LIST_FIELDS) next[field.key] = toList(raw[field.key])
        next.templates = toList(raw.templates)
        return next
      }

      const save = async () => {
        setNote({ text: '保存中…', tone: '' })
        try {
          await saveConfig(collect())
          setNote({ text: '已保存', tone: 'ok' })
        } catch (error) {
          setNote({ text: `保存失败：${(error && error.message) || error}`, tone: 'error' })
        }
      }

      const doPreview = () => {
        const line = compose(collect())
        setPreview(line || '（拼出来是空的，检查一下词表和表达式）')
      }

      const applyDir = async () => {
        try {
          await saveConfig({ stickersDir: dirText })
          setNote({ text: `表情目录已切到：${store.state.dir}`, tone: 'ok' })
        } catch (error) {
          setNote({ text: `切目录失败：${(error && error.message) || error}`, tone: 'error' })
        }
      }

      const insertVar = (variable) => {
        set('expression', `${draft.expression || ''}${variable}`)
      }

      return h('div', { className: 'kq-page' },
        h(StyleTag, { key: 'kq-css' }),
        h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '怎么拼'),
          h('div', { className: 'kq-choices' },
            [['expr', '表达式（随机拼）'], ['template', '整句模板']].map(([value, label]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'kq-choice',
                role: 'radio',
                'aria-checked': draft.mode === value ? 'true' : 'false',
                onClick: () => set('mode', value),
              }, label)),
          ),
        ),
        h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '连点夸夸时'),
          h('div', { className: 'kq-row-hint' }, '只影响按钮点出来的那几行，你自己打的字不会被碰。'),
          h('div', { className: 'kq-choices' },
            [['append', '继续加一条'], ['replace', '换掉上一条']].map(([value, label]) =>
              h('button', {
                key: value,
                type: 'button',
                className: 'kq-choice',
                role: 'radio',
                'aria-checked': ((draft.repeatMode || readRepeatMode()) === value) ? 'true' : 'false',
                onClick: () => { set('repeatMode', value); writeRepeatMode(value) },
              }, label)),
          ),
        ),
            h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '表达式'),
          h('input', {
            className: 'kq-input',
            value: draft.expression || '',
            placeholder: '{称呼}{夸奖}（{动作}）{颜文字}',
            onChange: (event) => set('expression', event.target.value),
          }),
          h('div', { className: 'kq-vars' },
            VARS.map((variable) => h('button', {
              key: variable,
              type: 'button',
              className: 'kq-var',
              onClick: () => insertVar(variable),
            }, variable)),
          ),
          h('div', { className: 'kq-row-hint' }, '哪张表是空的，那一段就整段消失，不会留个空括号。'),
          h('div', { className: 'kq-actions' },
            h('button', { type: 'button', className: 'kq-plain', onClick: doPreview }, '试一句'),
            preview ? h('span', { className: 'kq-note' }, preview) : null,
          ),
        ),
        ...LIST_FIELDS.map((field) => h('div', { key: field.key, className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, field.label),
          h('div', { className: 'kq-row-hint' }, field.hint),
          h('textarea', {
            className: 'kq-area',
            value: raw[field.key] || '',
            onChange: (event) => setRawField(field.key, event.target.value),
          }),
        )),
        h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '整句模板'),
          h('div', { className: 'kq-row-hint' }, '一行一句，可以用上面那些变量，也可以写死。切到「整句模板」时从这儿随机挑一句。'),
          h('textarea', {
            className: 'kq-area',
            value: raw.templates || '',
            onChange: (event) => setRawField('templates', event.target.value),
          }),
        ),
        h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '表情包目录'),
          h('div', { className: 'kq-row-hint' }, `留空就用默认目录。当前文件夹里 ${stickers.length} 张图。`),
          h('div', { className: 'kq-actions' },
            h('input', {
              className: 'kq-input',
              style: { flex: '1 1 260px' },
              value: dirText,
              placeholder: '例如 ~/Pictures/stickers',
              onChange: (event) => setDirText(event.target.value),
            }),
            h('button', { type: 'button', className: 'kq-plain', onClick: () => { void applyDir() } }, '切到这个目录'),
            h('button', { type: 'button', className: 'kq-plain', onClick: () => { void reveal() } }, '打开文件夹'),
          ),
        ),
        h('div', { className: 'kq-row' },
          h('div', { className: 'kq-row-title' }, '从 QQ 导入'),
          h('div', { className: 'kq-row-hint' }, '只读 QQ 的表情目录，复制进当前表情文件夹，导入这一步要你自己点。'),
          h('div', { className: 'kq-actions' },
            h('button', { type: 'button', className: 'kq-plain', disabled: qqBusy, onClick: () => { void scanQq() } }, '扫描 QQ 表情'),
          ),
          qqSources.length
            ? h('div', { className: 'kq-choices' },
                qqSources.map((source) => h('button', {
                  key: source.id,
                  type: 'button',
                  className: 'kq-choice',
                  role: 'checkbox',
                  'aria-checked': qqSelected.includes(source.id) ? 'true' : 'false',
                  onClick: () => setQqSelected((prev) => prev.includes(source.id)
                    ? prev.filter((id) => id !== source.id)
                    : prev.concat(source.id)),
                }, `${source.label} · ${source.count} 张`)),
              )
            : null,
          h('div', { className: 'kq-actions' },
            h('input', {
              className: 'kq-input',
              style: { flex: '1 1 240px' },
              value: qqDir,
              placeholder: '扫不到就手填，例如 …/nt_qq/nt_data/Emoji/personal_emoji/Ori',
              onChange: (event) => setQqDir(event.target.value),
            }),
            h('button', { type: 'button', className: 'kq-plain', disabled: qqBusy, onClick: () => { void scanManual() } }, '扫这个目录'),
          ),
          h('div', { className: 'kq-actions' },
            h('button', {
              type: 'button',
              className: 'kq-primary',
              disabled: qqBusy || (qqSelected.length === 0 && !qqDir.trim()),
              onClick: () => { void importQq() },
            }, '导入选中的'),
          ),
          qqPreview.length
            ? h('div', { className: 'kq-row' },
                h('div', { className: 'kq-row-hint' }, `预览（前 ${qqPreview.length} 张）`),
                h('div', {
                  className: 'kq-grid',
                  style: { gridTemplateColumns: 'repeat(8, 40px)', gridAutoRows: '40px', height: 'auto', gap: '4px', overflowX: 'hidden' },
                }, qqPreview.map((item) => h('div', {
                  key: item.url,
                  className: 'kq-cell',
                  title: item.name,
                }, h('img', { src: item.url, alt: '', loading: 'lazy', draggable: 'false' })))),
              )
            : null,
          h('div', { className: 'kq-note' }, qqNote),
        ),
        h('div', { className: 'kq-actions' },
          h('button', { type: 'button', className: 'kq-primary', onClick: () => { void save() } }, '保存'),
          h('button', {
            type: 'button',
            className: 'kq-plain',
            onClick: () => {
              if (!config) return
              setDraft({ ...config })
              const next = {}
              for (const field of LIST_FIELDS) next[field.key] = toText(config[field.key])
              next.templates = toText(config.templates)
              setRaw(next)
            },
          }, '撤销改动'),
          h('span', { className: `kq-note${note.tone === 'error' ? ' is-error' : note.tone === 'ok' ? ' is-ok' : ''}` }, note.text),
        ),
      )
    }

    /* ================================================================
     * 侧栏面板入口（左上角那一列）
     * ================================================================ */

    /** 面板行的图标：侧栏只负责行壳，图标由这里给。 */
    function KuakuIcon(props) {
      const size = props && Number.isFinite(props.size) ? Math.max(props.size, 18) : 18
      return h(PraiseGlyph, { size })
    }

    /** 中央面板：设置页原样搬过来，点左上角那一行就进这儿。 */
    function KuakuPanel() {
      return h('div', { className: 'kq-main' },
        h('div', { className: 'kq-main-head' },
          h('h1', { className: 'kq-main-title' }, '一键夸夸'),
          h('p', { className: 'kq-main-sub' }, '两枚按钮放进输入框，一句话随手可拼。改完点保存立刻生效。'),
        ),
        h(KuakuSettings),
      )
    }

    /* ================================================================
     * Module entry
     * ================================================================ */

    return {
      inject: ['slots'],
      apply(ctx) {
        const slot = (target, options, Component) => {
          try {
            ctx.slots.inject(target, () => ctx.slots.register(options, Component))
          } catch (error) {
            try { console.warn(`[dsh-kuakua] 挂 ${target} 失败:`, error) } catch {}
          }
        }

        // 输入栏左侧那排（工作区内修改所在的区域），排在最前面
        slot('conversation.input.left', { name: 'conversation.input.left', id: 'kuakua-inline', order: 1, label: '一键夸夸' }, (props) =>
          h(KuakuBar, props))

        // 设置页
        slot('settings.section', { name: 'settings.section', id: SECTION_ID, order: 62, label: '一键夸夸' }, () =>
          h(KuakuSettings))

        // 左上角那一列：侧栏行 + 中央面板，两个 key 得对上
        slot('sidebar.panellist', { name: 'sidebar.panellist', id: SECTION_ID, order: 60, label: '一键夸夸' }, () =>
          h(KuakuIcon))
        slot('main', { name: 'main', key: SECTION_ID, label: '一键夸夸' }, () =>
          h(KuakuPanel))
      },
    }
  },
})
