# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: independent-420-geometry.qa.spec.ts >> G1: real built Timeline geometry at1440/320 and actual CSS200% page text for5/6/15digits
- Location: e2e\independent-420-geometry.qa.spec.ts:114:1

# Error details

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 236

- Array []
+ Array [
+   Object {
+     "classes": "ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-inverse px-3 pointer-coarse:h-11 font-medium text-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:hidden",
+     "fontSize": "28px",
+     "id": "",
+     "left": 262.703125,
+     "right": 335.75,
+     "tag": "BUTTON",
+     "text": "Menu",
+   },
+   Object {
+     "classes": "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xl font-semibold tracking-[-0.01em] text-heading",
+     "fontSize": "40px",
+     "id": "",
+     "left": -9,
+     "right": 64.890625,
+     "tag": "H1",
+     "text": "Run",
+   },
+   Object {
+     "classes": "font-mono text-md font-medium tracking-normal text-muted",
+     "fontSize": "28px",
+     "id": "",
+     "left": -9,
+     "right": 427.8125,
+     "tag": "SPAN",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA1",
+   },
+   Object {
+     "classes": "min-w-0 wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 20.71875,
+     "tag": "SPAN",
+     "text": "at ",
+   },
+   Object {
+     "classes": "touch-target font-medium text-link underline-offset-[3px] hover:underline",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 110.328125,
+     "tag": "A",
+     "text": "child runs",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 363.453125,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 300.359375,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 282.15625,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 297.21875,
+     "right": 330.828125,
+     "tag": "P",
+     "text": "10",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 330.828125,
+     "right": 336.46875,
+     "tag": "P",
+     "text": ". Run deadline:",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 328.609375,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 326.46875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 346.96875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 184.921875,
+     "tag": "P",
+     "text": "History retained.",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 353,
+     "tag": "SPAN",
+     "text": "Review delete-ready history",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 359.625,
+     "tag": "SPAN",
+     "text": "Withdraw delete-ready mark",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 6.609375,
+     "tag": "SPAN",
+     "text": "1",
+   },
+   Object {
+     "classes": "text-sm wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": 212.515625,
+     "right": 347.28125,
+     "tag": "P",
+     "text": " · version ID ",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "23.92px",
+     "id": "",
+     "left": 12,
+     "right": 342.109375,
+     "tag": "CODE",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA0",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 177.34375,
+     "right": 321.296875,
+     "tag": "SPAN",
+     "text": "Load newer",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 362.140625,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 347.125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 305.328125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+ ]
```

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 236

- Array []
+ Array [
+   Object {
+     "classes": "ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-inverse px-3 pointer-coarse:h-11 font-medium text-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:hidden",
+     "fontSize": "28px",
+     "id": "",
+     "left": 262.703125,
+     "right": 335.75,
+     "tag": "BUTTON",
+     "text": "Menu",
+   },
+   Object {
+     "classes": "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xl font-semibold tracking-[-0.01em] text-heading",
+     "fontSize": "40px",
+     "id": "",
+     "left": -9,
+     "right": 64.890625,
+     "tag": "H1",
+     "text": "Run",
+   },
+   Object {
+     "classes": "font-mono text-md font-medium tracking-normal text-muted",
+     "fontSize": "28px",
+     "id": "",
+     "left": -9,
+     "right": 427.8125,
+     "tag": "SPAN",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA1",
+   },
+   Object {
+     "classes": "min-w-0 wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 20.71875,
+     "tag": "SPAN",
+     "text": "at ",
+   },
+   Object {
+     "classes": "touch-target font-medium text-link underline-offset-[3px] hover:underline",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 110.328125,
+     "tag": "A",
+     "text": "child runs",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 363.453125,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 300.359375,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 282.15625,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 297.21875,
+     "right": 330.828125,
+     "tag": "P",
+     "text": "10",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 330.828125,
+     "right": 336.46875,
+     "tag": "P",
+     "text": ". Run deadline:",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 328.609375,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 326.46875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 346.96875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 184.921875,
+     "tag": "P",
+     "text": "History retained.",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 353,
+     "tag": "SPAN",
+     "text": "Review delete-ready history",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 359.625,
+     "tag": "SPAN",
+     "text": "Withdraw delete-ready mark",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 6.609375,
+     "tag": "SPAN",
+     "text": "1",
+   },
+   Object {
+     "classes": "text-sm wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": 212.515625,
+     "right": 347.28125,
+     "tag": "P",
+     "text": " · version ID ",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "23.92px",
+     "id": "",
+     "left": 12,
+     "right": 342.109375,
+     "tag": "CODE",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA0",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 177.34375,
+     "right": 321.296875,
+     "tag": "SPAN",
+     "text": "Load newer",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 362.140625,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 347.125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 305.328125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+ ]
```

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toBeLessThanOrEqual(expected)

Expected: <= 321
Received:    453
```

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -   1
+ Received  + 236

- Array []
+ Array [
+   Object {
+     "classes": "ml-auto inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-inverse px-3 pointer-coarse:h-11 font-medium text-inverse focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:hidden",
+     "fontSize": "28px",
+     "id": "",
+     "left": 262.703125,
+     "right": 335.75,
+     "tag": "BUTTON",
+     "text": "Menu",
+   },
+   Object {
+     "classes": "flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-xl font-semibold tracking-[-0.01em] text-heading",
+     "fontSize": "40px",
+     "id": "",
+     "left": -9,
+     "right": 64.890625,
+     "tag": "H1",
+     "text": "Run",
+   },
+   Object {
+     "classes": "font-mono text-md font-medium tracking-normal text-muted",
+     "fontSize": "28px",
+     "id": "",
+     "left": -9,
+     "right": 427.8125,
+     "tag": "SPAN",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA1",
+   },
+   Object {
+     "classes": "min-w-0 wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 20.71875,
+     "tag": "SPAN",
+     "text": "at ",
+   },
+   Object {
+     "classes": "touch-target font-medium text-link underline-offset-[3px] hover:underline",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 110.328125,
+     "tag": "A",
+     "text": "child runs",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 363.453125,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 300.359375,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "resume-reason-01M3Y7RKG0J12P2PE9EMAV5SA1",
+     "left": -9,
+     "right": 282.15625,
+     "tag": "P",
+     "text": "Resume unavailable: This run is still active. Pause it before continuing with Re",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 297.21875,
+     "right": 330.828125,
+     "tag": "P",
+     "text": "10",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 330.828125,
+     "right": 336.46875,
+     "tag": "P",
+     "text": ". Run deadline:",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 328.609375,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 326.46875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "28px",
+     "id": "",
+     "left": 12,
+     "right": 346.96875,
+     "tag": "P",
+     "text": "Limits are pinned for this run. Gate pass limits and node watchdogs follow its p",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 184.921875,
+     "tag": "P",
+     "text": "History retained.",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 353,
+     "tag": "SPAN",
+     "text": "Review delete-ready history",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 3,
+     "right": 359.625,
+     "tag": "SPAN",
+     "text": "Withdraw delete-ready mark",
+   },
+   Object {
+     "classes": "text-sm text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": -9,
+     "right": 6.609375,
+     "tag": "SPAN",
+     "text": "1",
+   },
+   Object {
+     "classes": "text-sm wrap-anywhere",
+     "fontSize": "26px",
+     "id": "",
+     "left": 212.515625,
+     "right": 347.28125,
+     "tag": "P",
+     "text": " · version ID ",
+   },
+   Object {
+     "classes": "",
+     "fontSize": "23.92px",
+     "id": "",
+     "left": 12,
+     "right": 342.109375,
+     "tag": "CODE",
+     "text": "01M3Y7RKG0J12P2PE9EMAV5SA0",
+   },
+   Object {
+     "classes": "min-w-0 overflow-x-clip text-ellipsis",
+     "fontSize": "26px",
+     "id": "",
+     "left": 177.34375,
+     "right": 321.296875,
+     "tag": "SPAN",
+     "text": "Load newer",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "min-w-0 grow basis-40 break-words text-muted",
+     "fontSize": "26px",
+     "id": "",
+     "left": 8,
+     "right": 342.703125,
+     "tag": "SPAN",
+     "text": "Start (start) (trigger) attempt 1",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 362.140625,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 347.125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+   Object {
+     "classes": "text-xs text-muted",
+     "fontSize": "24px",
+     "id": "",
+     "left": -9,
+     "right": 305.328125,
+     "tag": "P",
+     "text": "Activity below covers the retained history window. Earlier activity is available",
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: GraphGoblin
    - button "Menu" [ref=e22] [cursor=pointer]
  - generic [ref=e25]:
    - banner [ref=e26]:
      - generic [ref=e27]:
        - heading "Run 01M3Y7RKG0J12P2PE9EMAV5SA1" [level=1] [ref=e28]:
          - text: Run
          - generic [ref=e29]: 01M3Y7RKG0J12P2PE9EMAV5SA1
        - generic [ref=e30]: waiting
      - generic [ref=e34]:
        - generic [ref=e35]: at Approve (approve)
        - link "loop" [ref=e36] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG0J12P2PE9EMAV5S9Z/edit
        - link "child runs" [ref=e37] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG0J12P2PE9EMAV5SA1
      - generic [ref=e39]:
        - generic [ref=e40]:
          - button "Pause" [ref=e41] [cursor=pointer]
          - button "Resume" [disabled]
          - button "Cancel run" [ref=e45] [cursor=pointer]
          - button "Replay..." [ref=e50] [cursor=pointer]
        - paragraph [ref=e52]: "Resume unavailable: This run is still active. Pause it before continuing with Resume."
    - region [ref=e53]:
      - heading "Execution limits" [level=2] [ref=e55]
      - generic [ref=e56]:
        - paragraph [ref=e57]: "Maximum node visits: 10. Run deadline: none."
        - paragraph [ref=e58]: "Structured completion: Unlimited."
        - paragraph [ref=e59]: Limits are pinned for this run. Gate pass limits and node watchdogs follow its pinned definition.
    - generic [ref=e60]:
      - paragraph [ref=e61]: History retained.
      - generic [ref=e62]:
        - button "Review delete-ready history" [ref=e63] [cursor=pointer]
        - button "Withdraw delete-ready mark" [ref=e65] [cursor=pointer]
        - generic [ref=e67]: 1 selected
    - region [ref=e68]:
      - heading "Execution context" [level=2] [ref=e70]
      - generic [ref=e71]:
        - paragraph [ref=e72]:
          - text: Independent geometry [2ca4a07e-1] v1 · version ID
          - code [ref=e73]: 01M3Y7RKG0J12P2PE9EMAV5SA0
        - button "Exact run record" [ref=e75] [cursor=pointer]
        - button "Pinned definition JSON" [ref=e81] [cursor=pointer]
    - region [ref=e86]:
      - heading "Input requested" [level=2] [ref=e88]
      - generic [ref=e93]:
        - paragraph [ref=e94]: At Approve (approve)
        - generic "Prompt" [ref=e96]: Approve?
        - form "Submit input" [ref=e97]:
          - generic [ref=e98]:
            - generic [ref=e99]: Input (JSON)
            - textbox "Input (JSON)" [ref=e102]:
              - /placeholder: "{}"
          - button "Submit input" [ref=e104] [cursor=pointer]
    - generic [ref=e106]:
      - region [ref=e107]:
        - heading "Timeline (123456789012345 events, live)" [level=2] [ref=e109]
        - generic [ref=e113]:
          - generic [ref=e114]:
            - button "Load older" [disabled] [ref=e115]
            - button "Previous rows" [disabled] [ref=e117]
            - button "Next rows" [disabled] [ref=e119]
            - button "Load newer" [disabled] [ref=e121]
            - button "Follow live" [disabled] [ref=e123]
            - generic [ref=e125]: Showing events 1–123456789012345 of the retained window.
            - generic [ref=e126]: Following live.
          - generic [ref=e127]:
            - generic [ref=e128]:
              - text: Event sequence
              - spinbutton "Event sequence" [ref=e129]
            - button "Go to event" [ref=e130] [cursor=pointer]
          - list "Timeline" [ref=e132]:
            - listitem [ref=e133]:
              - button "#1 run.queued" [ref=e134] [cursor=pointer]:
                - generic [ref=e135]: "#1"
                - code [ref=e136]: run.queued
            - listitem [ref=e137]:
              - button "#2 run.started attempt 1" [ref=e138] [cursor=pointer]:
                - generic [ref=e139]: "#2"
                - code [ref=e140]: run.started
                - generic [ref=e141]: attempt 1
            - listitem [ref=e142]:
              - button "#10593 node.started Start (start) (trigger) attempt 1" [ref=e143] [cursor=pointer]:
                - generic [ref=e144]: "#10593"
                - code [ref=e145]: node.started
                - generic [ref=e146]: Start (start) (trigger) attempt 1
            - listitem [ref=e147]:
              - button "#123456 node.started Start (start) (trigger) attempt 1" [ref=e148] [cursor=pointer]:
                - generic [ref=e149]: "#123456"
                - code [ref=e150]: node.started
                - generic [ref=e151]: Start (start) (trigger) attempt 1
            - listitem [ref=e152]:
              - button "#123456789012345 node.started Start (start) (trigger) attempt 1" [ref=e153] [cursor=pointer]:
                - generic [ref=e154]: "#123456789012345"
                - code [ref=e155]: node.started
                - generic [ref=e156]: Start (start) (trigger) attempt 1
      - generic [ref=e157]:
        - 'button "Exact recorded event #123456789012345" [ref=e159] [cursor=pointer]'
        - region [ref=e165]:
          - heading "Current thread" [level=2] [ref=e167]
          - generic [ref=e169]:
            - generic [ref=e170]:
              - heading "Messages (0)" [level=3] [ref=e171]
              - list "Messages"
            - generic [ref=e172]:
              - heading "Variables" [level=3] [ref=e173]
              - generic "Variables" [ref=e175]: "{}"
            - button "Full thread JSON" [ref=e177] [cursor=pointer]
        - paragraph [ref=e182]: Activity below covers the retained history window. Earlier activity is available through Load older.
        - button "Node progress (0 nodes)" [ref=e184] [cursor=pointer]
```

# Test source

```ts
  241 |             rect: box(ancestor.getBoundingClientRect()),
  242 |             clientLeft: ancestor.clientLeft,
  243 |             clientTop: ancestor.clientTop,
  244 |             clientWidth: ancestor.clientWidth,
  245 |             clientHeight: ancestor.clientHeight,
  246 |           });
  247 |       }
  248 |       const paintable = raw.map((rect) => {
  249 |         let left = rect.left,
  250 |           right = rect.right,
  251 |           top = rect.top,
  252 |           bottom = rect.bottom;
  253 |         for (const clip of clips) {
  254 |           if (clip.x) {
  255 |             left = Math.max(left, clip.rect.left + clip.clientLeft);
  256 |             right = Math.min(right, clip.rect.left + clip.clientLeft + clip.clientWidth);
  257 |           }
  258 |           if (clip.y) {
  259 |             top = Math.max(top, clip.rect.top + clip.clientTop);
  260 |             bottom = Math.min(bottom, clip.rect.top + clip.clientTop + clip.clientHeight);
  261 |           }
  262 |         }
  263 |         return {
  264 |           left,
  265 |           right,
  266 |           top,
  267 |           bottom,
  268 |           width: Math.max(0, right - left),
  269 |           height: Math.max(0, bottom - top),
  270 |         };
  271 |       });
  272 |       const visibleInViewport = paintable
  273 |         .map((rect) => ({
  274 |           left: Math.max(0, rect.left),
  275 |           right: Math.min(innerWidth, rect.right),
  276 |           top: Math.max(0, rect.top),
  277 |           bottom: Math.min(innerHeight, rect.bottom),
  278 |         }))
  279 |         .filter((rect) => rect.right > rect.left && rect.bottom > rect.top && hidden.length === 0);
  280 |       textCulprits.push({
  281 |         text: node.textContent.slice(0, 160),
  282 |         textLength: node.textContent.length,
  283 |         parent: identity(parent),
  284 |         raw: raw.map(box),
  285 |         hiddenAncestors: hidden,
  286 |         clipChain: clips,
  287 |         paintableBeforeViewportClip: paintable,
  288 |         visibleInViewport,
  289 |         paintableOutsideX:
  290 |           hidden.length === 0 &&
  291 |           paintable.some((rect) => rect.width > 0 && rect.height > 0 && outsideX(rect)),
  292 |       });
  293 |     }
  294 |     const elementCulprits = [...document.body.querySelectorAll('*')]
  295 |       .filter((element) => {
  296 |         const rect = element.getBoundingClientRect();
  297 |         return (
  298 |           rect.width > 0 &&
  299 |           rect.height > 0 &&
  300 |           (outsideX(rect) || element.scrollWidth > element.clientWidth + 1)
  301 |         );
  302 |       })
  303 |       .map(identity);
  304 |     return {
  305 |       viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY },
  306 |       fontsStatus: document.fonts.status,
  307 |       document: identity(document.documentElement),
  308 |       body: identity(document.body),
  309 |       scannedTextNodes,
  310 |       textCulprits,
  311 |       elementCulprits,
  312 |       qualification:
  313 |         'Raw element and text-range boxes are native measurements. Contained-clipped and viewport-intersection boxes are calculated from those measured boxes; they do not establish painted pixels, occlusion, transforms or arbitrary clip-path visibility. Hidden/transparent ancestor and computed style records qualify possible culprits. A raw offscreen/hidden range is not claimed visible; all existing strict assertions remain unchanged.',
  314 |     };
  315 |   });
  316 |   const measurement = {
  317 |     seq,
  318 |     eventType,
  319 |     number: numberMetrics,
  320 |     type: typeMetrics,
  321 |     viewport,
  322 |     overlaps,
  323 |     culprits,
  324 |   };
  325 |   const label = `geometry-${viewport.width}-${seq}-${Math.round(numberMetrics.fontSize)}`;
  326 |   await test
  327 |     .info()
  328 |     .attach(label, { body: JSON.stringify(measurement), contentType: 'application/json' });
  329 |   await test
  330 |     .info()
  331 |     .attach(label + '-render', { body: await page.screenshot(), contentType: 'image/png' });
  332 |   // Geometric failures still fail G1, but all12 admitted samples must be measured.
  333 |   // Setup/selector/schema checks above remain hard assertions.
  334 |   expect.soft(numberMetrics.rects.length).toBeGreaterThan(0);
  335 |   expect.soft(typeMetrics.rects.length).toBeGreaterThan(0);
  336 |   expect.soft(numberMetrics.clipping).toEqual([]);
  337 |   expect.soft(typeMetrics.clipping).toEqual([]);
  338 |   expect.soft(overlaps).toEqual([]);
  339 |   expect.soft(viewport.scrollWidth).toBeLessThanOrEqual(viewport.width + 1);
  340 |   expect.soft(viewport.bodyScrollWidth).toBeLessThanOrEqual(viewport.width + 1);
> 341 |   expect.soft(viewport.visibleTextOutsideViewport).toEqual([]);
      |                                                    ^ Error: expect(received).toEqual(expected) // deep equality
  342 |   return measurement;
  343 | }
  344 | 
  345 | /** Actual computed CSS enlargement of existing whole-page text. Not native zoom/device scale. */
  346 | export async function enlargeTimelineText(page: Page, factor: 2) {
  347 |   const changed = await page.locator('body').evaluateAll((rows, scale) => {
  348 |     const nodes = new Set<HTMLElement>();
  349 |     for (const row of rows) {
  350 |       if (row instanceof HTMLElement) nodes.add(row);
  351 |       for (const child of row.querySelectorAll('*'))
  352 |         if (child instanceof HTMLElement && !['SCRIPT', 'STYLE'].includes(child.tagName))
  353 |           nodes.add(child);
  354 |     }
  355 |     const baseline = [...nodes].map((element) => ({
  356 |       element,
  357 |       size: parseFloat(getComputedStyle(element).fontSize),
  358 |       inline: element.style.fontSize,
  359 |     }));
  360 |     for (const { element, size, inline } of baseline) {
  361 |       element.dataset['i5QaFontBefore'] = inline;
  362 |       element.dataset['i5QaFontComputedBefore'] = String(size);
  363 |       element.style.fontSize = `${size * scale}px`;
  364 |     }
  365 |     return baseline.length;
  366 |   }, factor);
  367 |   expect(changed).toBeGreaterThan(0);
  368 |   return async () => {
  369 |     await page.locator('[data-i5-qa-font-before]').evaluateAll((nodes) => {
  370 |       for (const node of nodes)
  371 |         if (node instanceof HTMLElement) {
  372 |           node.style.fontSize = node.dataset['i5QaFontBefore'] ?? '';
  373 |           delete node.dataset['i5QaFontBefore'];
  374 |           delete node.dataset['i5QaFontComputedBefore'];
  375 |         }
  376 |     });
  377 |   };
  378 | }
  379 | 
  380 | export function expectActualTextGrowth(
  381 |   normal: Awaited<ReturnType<typeof measureTimelineRow>>,
  382 |   enlarged: Awaited<ReturnType<typeof measureTimelineRow>>,
  383 | ) {
  384 |   expect.soft(enlarged.number.fontSize).toBeGreaterThanOrEqual(normal.number.fontSize * 1.99);
  385 |   expect.soft(enlarged.type.fontSize).toBeGreaterThanOrEqual(normal.type.fontSize * 1.99);
  386 |   expect.soft(enlarged.seq).toBe(normal.seq);
  387 |   expect.soft(enlarged.eventType).toBe(normal.eventType);
  388 | }
  389 | 
```