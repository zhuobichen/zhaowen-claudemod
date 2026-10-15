// The pane's drawing module.
//
// It holds no text of its own: the hooks module keeps the book and hands this one
// page at a time, because a Client's props are capped at 100,000 characters — a
// novel is nothing like that small. It answers keys by posting them back, and the
// hooks module decides what a key means and answers with the next page, which
// keeps every rule in the tested half.
//
// No imports here, not even `import type`: a surface module that imports anything
// drew nothing at all when this was written (the element arrived empty, no error
// anywhere), while the same code with the types inlined drew every row. The hooks
// module may import freely; this file may not.

const Client = (props: any, surface: any) => {
  // Registered once, while the instance is unstarted: a later call replaces the
  // listener, and `setState` on every render is a render loop that unmounts it.
  if (surface.state === undefined) {
    surface.setState({})
    surface.onKey((event: { key: string }) => surface.post({ key: event.key }))

    // the mouse needs no focus, so this is the way to turn a page while the
    // prompt still holds the keys
    surface.onPointer((event: { type: string; y: number }) => {
      if (event.type === 'down') surface.post({ clickY: event.y, rows: props.rows })
    })
  }

  const { Box, Text } = surface.elements
  const rows = Math.max(1, props.rows ?? props.lines.length)
  const drawn = Array.from({ length: rows }, (_, row) =>
    Text({ key: `row-${row}`, wrap: 'truncate-end', children: props.lines[row] ?? '' }),
  )

  return Box({
    key: 'novel',
    flexDirection: 'column',
    width: '100%',
    children: [
      ...drawn,
      Text({ key: 'foot', dimColor: true, wrap: 'truncate-end', children: `${props.progress}　${props.keys}` }),
    ],
  })
}

export default Client
