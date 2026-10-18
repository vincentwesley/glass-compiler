# Decisions

Each decision has the reason it was made. Newest decisions go at the bottom.

## D1. The language is called **Pane**

A pane is a sheet of glass you look *through*, which is the whole point of the
project. It is short, easy to say and the file extension `.pane` doesn't clash
with anything common.

## D2. Pane is deliberately small

Pane has numbers, strings, booleans, `nil`, `let` variables, assignment,
arithmetic, comparison, `and`/`or`/`not`, `if`/`else`, `while`, blocks with
lexical scope, `print`, and top-level functions with parameters, `return` and
recursion. Comments start with `#`.

**Why:** every feature has to be visible in four panels at once. Each one
added here makes the tree bigger and the bytecode longer. This set is enough
for FizzBuzz, Fibonacci and loops, which are what people actually try first.

**Left out on purpose:** closures (they need upvalues, which are hard to draw),
classes, arrays, `for` loops (sugar over `while`), and nested function
declarations (rejected with a clear compile error so nobody expects closures).

## D3. Statements end with `;`

Semicolons make every statement boundary a visible token, avoid the newline
ambiguities that Lua and JavaScript have, and let the parser recover from an
error by skipping to the next `;`.

## D4. Hand-written lexer, Pratt parser, explicit AST

A hand-written lexer is short and lets every token carry an exact source span.
The parser is recursive descent for statements and a **Pratt parser** with
matklad-style *binding-power pairs* for expressions. The binding-power table is
exported and shown in the UI.

Unlike clox, we **keep an AST** between parsing and code generation, because
the tree is one of the things we want to show.

Parentheses produce a `Group` node. It emits no bytecode, which is itself
something worth seeing: grouping changes the *shape* of the tree, not the
instructions.

## D5. One shared identity, the node id, links every stage

- every token knows the AST node that "owns" it (the `+` belongs to its
  `Binary` node, `let`, the name, `=` and `;` belong to the `Let` node, and so on);
- every instruction records the node id that emitted it;
- every VM step records which instruction (chunk + address) it executed.

So "click anything, see everything" is one lookup: whatever you click resolves
to a node id, and each panel highlights what belongs to that node.

## D6. Bytecode design

Stack machine, one chunk per function plus `main`, jump operands are absolute
addresses (easier to read than relative offsets), `JUMP_IF_FALSE` pops its
condition, and `and`/`or` use `DUP` so the listing never has a dangling `POP`
to explain. Top-level `let` creates a global; `let` inside a block or function
uses a stack slot. Function calls push a frame whose base is the first
argument's stack slot, as in clox.

## D7. The VM records a full trace, the UI scrubs it

The VM runs the whole program up front and records a snapshot before each
instruction (stack, frames with named locals, globals, output). The UI then
moves through that trace, so stepping **backwards** is free and the scrubber
always knows how long the run is. Limits: 5,000 steps and 64 nested calls, so
an infinite loop or runaway recursion ends with a friendly message rather than
freezing the tab.

Runtime errors (adding a number to `true`, dividing by zero, calling something
that isn't a function, wrong number of arguments, reading an undefined variable)
stop the run and point at the node that caused them. Division by zero is an
error rather than `Infinity` because that is easier for beginners to reason about.

Strings can be joined to anything with `+` (`"n = " + 3`), which keeps the
examples readable without needing a `str()` function.

## D8. No UI framework

Plain TypeScript modules and a tiny DOM helper. The app has five panels and one
selection store; a framework would add more bundle than it saves code, and plain
DOM keeps the CSP simple.

## D9. CodeMirror 6 (view + state + commands only)

CodeMirror gives an accessible, mobile-friendly editor with undo/redo and line
numbers. Syntax highlighting comes from **Pane's own lexer** through a view
plugin, rather than a separate grammar, so the colours in the editor are exactly
the token kinds shown in the Tokens panel.

## D10. SVG tree, own layout

The syntax tree is laid out by a small tidy-tree algorithm (each subtree gets
its own horizontal band; parents are centred over their children) and drawn as
SVG. This avoids pulling in d3 for one layout function and keeps nodes as real
focusable elements.

## D11. Content Security Policy in a meta tag

GitHub Pages can't send custom headers, so `index.html` carries:

```
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:;
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self';
form-action 'none'; manifest-src 'self'; worker-src 'none'
```

No inline scripts and no third-party hosts. The no-flash theme loader is an
external file (`public/theme-init.js`). CodeMirror's injected styles use
constructable stylesheets and CSSOM, which `style-src 'self'` allows; the e2e
suite fails if the browser reports any CSP violation.

## D12. Dark by default, light only by choice

The dark theme lives on `:root`, so it applies with JavaScript off and with the
OS set to light. The mint light theme only applies when the toggle sets
`data-theme="light"` on `<html>`; the choice is stored in `localStorage`.

## D13. Playwright pinned to 1.56.1

That version matches the Chromium build pre-installed in the cloud session, so
end-to-end tests run without downloading browsers. CI runs typecheck, lint, unit
tests and build (as requested); browser tests run locally before each push.

## D14. Mobile layout stacks the panels

At 375px all stages stay visible in one scrolling column rather than hiding
behind tabs, so clicking a token still visibly lights up the other stages
below it. A "jump to stage" bar at the top scrolls to each panel.
