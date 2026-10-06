import { expect, mock, test } from 'claude-code/testing'

const PANE_PROPS = {
  title: 'QUOTA REACTOR',
  isFocused: false,
  bodyColumns: 48,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 30 },
  view: {},
} as const

const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 3,
  bodyColumns: 80,
  scroll: { offset: 0, bodyRows: 3 },
  view: {},
} as const

test('Bash実行中は赤い警告帯が出て、終わると消える', async ($, on) => {
  const clock = mock.clock(on, { now: 1000 })
  // 警告がないとき帯はエンジン既定の描画に譲るので、その代役を置く
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
  let finish = () => {}
  on('tool.call', () => new Promise(resolve => (finish = () => resolve({ result: 'ok' }))))

  const running = $.tool.call({ tool: 'Bash', command: 'npm test' })
  await clock.settle()

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({
      plugin: 'quota-reactor',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })
    expect(await band.find({ text: /警告 EMERGENCY/ })).toBeDefined()
    expect(await band.find({ text: /npm test/ })).toBeDefined()
    await band.unmount()
  }
  await clock.advance(600)

  finish()
  await running
  const band = await $.ui.mount({
    plugin: 'quota-reactor',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await band.find({ text: /警告/ })).toBeUndefined()
  await band.unmount()
})

test('利用枠が届くと稼働限界を現在のペースで出し、90%超えで警告帯を出す', async ($, on) => {
  // 5時間枠は開始から3時間で80%使用。このペースなら45分後に使い切る
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  await $.session.measure({
    context: { window: 200_000 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 80, resetsAt: '2026-10-05T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 95, resetsAt: '2026-10-08T00:00:00Z' },
      { kind: 'seven_day_fable', percentUsed: 40, resetsAt: '2026-10-08T00:00:00Z' },
    ],
    changed: ['rateLimits'],
  })

  const pane = await $.ui.mount({
    plugin: 'quota-reactor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'reactor-core',
    props: PANE_PROPS,
  })
  expect(await pane.find({ text: /5時間枠 .* 残20% 稼働限界まで 0:45 \[OVERRUN\]/ })).toBeDefined()
  // Fable週次は枠の63%が経過して40%使用。ペースは半分以上なのでNORMAL
  expect(await pane.find({ text: /Fable週次 .* 残60% 枠更新まで .* \[NOMINAL\]/ })).toBeDefined()
  await pane.unmount()

  // 広いパネルは原寸3基を横、中くらいは上下を詰めた帯を縦、狭いパネルは原寸を縦に積む。
  // 枠(iframe)は宣言どおりの大きさで描かれるので、幅はセル数から、高さは縦横比から明示する
  for (const [bodyColumns, viewBox, width, height] of [
    [130, 'viewBox="0 0 1228 214"', 988, 172],
    [100, 'viewBox="0 0 600 370"', 760, 469],
    [48, 'viewBox="0 0 400 670"', 364, 610],
  ] as const) {
    const desktop = await $.ui.mount({
      plugin: 'quota-reactor',
      surface: 'desktop',
      component: 'Pane',
      requestId: 'reactor-core',
      props: { ...PANE_PROPS, bodyColumns },
    })
    const power = (await desktop.findAll({ type: 'Svg' })).find(one =>
      String(one.props.alt).startsWith('稼働限界'),
    )
    const source = String(power?.props.source)
    expect(source).toContain('Fable週次')
    expect(source).toContain(viewBox)
    expect(source).toContain('OVERRUN')
    // 基のすき間から枠(iframe)の白い地が透けないよう、全面を黒で塗っている
    expect(source).toContain('style="background:#050505"')
    expect(source).toMatch(/<rect width="\d+" height="\d+" fill="#050505"\/>/)
    expect(power?.props.width).toBe(width)
    expect(power?.props.height).toBe(height)
    expect(source).toContain(`width="${width}" height="${height}"`)
    await desktop.unmount()
  }

  const band = await $.ui.mount({
    plugin: 'quota-reactor',
    surface: 'desktop',
    component: 'AbovePrompt',
    props: BAND_PROPS,
  })
  expect(await band.find({ text: /稼働限界接近/ })).toBeDefined()
  expect(await band.find({ text: /週次 残り5%/ })).toBeDefined()
  await band.unmount()
})

test('利用枠が2つのとき、3基目にコンテキスト残量を出す', async ($, on) => {
  mock.clock(on, { now: Date.parse('2026-10-05T10:00:00Z') })
  on('session.measure', (_, e) => ({ changed: e.changed }))
  // 200kの窓で120k使用。残り40.0%、使用60%なのでCAUTION
  await $.session.measure({
    context: { tokens: 120_000, window: 200_000, percent: 60 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 18, resetsAt: '2026-10-05T12:00:00Z' },
      { kind: 'seven_day', percentUsed: 12, resetsAt: '2026-10-08T00:00:00Z' },
    ],
    changed: ['rateLimits', 'context'],
  })

  const terminal = await $.ui.mount({
    plugin: 'quota-reactor',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'reactor-core',
    props: PANE_PROPS,
  })
  expect(await terminal.find({ text: /コンテキスト 残り容量（%） 使用 120k \/ 200k \[CAUTION\]/ })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount({
    plugin: 'quota-reactor',
    surface: 'desktop',
    component: 'Pane',
    requestId: 'reactor-core',
    props: { ...PANE_PROPS, bodyColumns: 70 },
  })
  const power = (await desktop.findAll({ type: 'Svg' })).find(one =>
    String(one.props.alt).startsWith('稼働限界'),
  )
  const source = String(power?.props.source)
  expect(source).toContain('コンテキスト')
  expect(source).toContain('CAUTION')
  expect(source).not.toContain('NO SIGNAL')
  // 残り82%と88%の利用枠は黄、残り40%のコンテキストは橙で描く
  expect(source.split('url(#frame-yellow)').length - 1).toBe(2)
  expect(source.split('url(#frame-amber)').length - 1).toBe(1)
  expect(source).not.toContain('url(#frame-red)')
  await desktop.unmount()
})

test('ツール実行が可決・否決として記録され、両サーフェスで描ける', async ($, on) => {
  mock.clock(on, { now: 1000 })
  on('tool.call', (_, e) =>
    e.tool === 'Edit' ? { isError: true, result: 'old_string not found' } : { result: 'ok' },
  )

  await $.tool.call({ tool: 'Read', file_path: '/src/app.ts' })
  await $.tool.call({ tool: 'Edit', file_path: '/src/app.ts', old_string: 'a', new_string: 'b' })

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'quota-reactor',
      surface,
      component: 'Pane',
      requestId: 'reactor-core',
      props: PANE_PROPS,
    })
    if (surface === 'desktop') {
      // 文字はすべてSVGの中で明朝体として描く
      const svg = (await pane.findAll({ type: 'Svg' })).find(one => String(one.props.alt).startsWith('TRIAD'))
      const source = String(svg?.props.source)
      expect(source).toContain('否決')
      expect(source).toContain('作戦記録')
      expect(source).toContain('app.ts')
      expect(source).toContain('Hiragino Mincho')
      expect(await pane.find({ type: 'Text' })).toBeUndefined()
    } else {
      expect(await pane.find({ text: /作戦記録/ })).toBeDefined()
      expect(await pane.find({ text: /app\.ts/ })).toBeDefined()
      expect(await pane.find({ text: /SCRIBE・2 否決/ })).toBeDefined()
    }
    await pane.unmount()

    const band = await $.ui.mount({
      plugin: 'quota-reactor',
      surface,
      component: 'AbovePrompt',
      props: BAND_PROPS,
    })
    expect(await band.find({ text: /否決/ })).toBeDefined()
    await band.unmount()
  }
})
