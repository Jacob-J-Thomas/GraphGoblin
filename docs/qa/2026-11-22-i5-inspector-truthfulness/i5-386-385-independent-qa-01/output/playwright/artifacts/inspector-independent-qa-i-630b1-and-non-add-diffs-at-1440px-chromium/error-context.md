# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-independent-qa.spec.ts >> independent P1-P5: real recorded repeated appends and non-add diffs at 1440px
- Location: e2e\inspector-independent-qa.spec.ts:64:3

# Error details

```
Test timeout of 60000ms exceeded.
```

```
Error: page.waitForEvent: Test timeout of 60000ms exceeded.
=========================== logs ===========================
waiting for event "download"
============================================================
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - banner [ref=e4]:
    - generic [ref=e5]: GraphGoblin
    - navigation "Main" [ref=e22]:
      - link "Chat" [ref=e23] [cursor=pointer]:
        - /url: /app/chat
      - link "Loops" [ref=e25] [cursor=pointer]:
        - /url: /app/loops
      - link "Runs" [ref=e27] [cursor=pointer]:
        - /url: /app/runs
      - link "Events" [ref=e29] [cursor=pointer]:
        - /url: /app/events
      - link "Settings" [ref=e31] [cursor=pointer]:
        - /url: /app/settings
  - generic [ref=e33]:
    - banner [ref=e34]:
      - generic [ref=e35]:
        - heading "Run 01M3Y7RKG08PAHHFN9FXPXTNS2" [level=1] [ref=e36]:
          - text: Run
          - generic [ref=e37]: 01M3Y7RKG08PAHHFN9FXPXTNS2
        - generic [ref=e38]: succeeded
      - generic [ref=e42]:
        - link "loop" [ref=e43] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG08PAHHFN9FXPXTNS0/edit
        - link "child runs" [ref=e44] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG08PAHHFN9FXPXTNS2
      - generic [ref=e46]:
        - generic [ref=e47]:
          - button "Resume" [disabled]
          - button "Replay..." [ref=e48] [cursor=pointer]
        - paragraph [ref=e50]: "Resume unavailable: This run has finished. Resume only continues paused runs or supported failures."
    - region [ref=e51]:
      - heading "Exit evaluation" [level=2] [ref=e53]
      - generic [ref=e54]:
        - paragraph [ref=e55]: "Done (done): Exited: success"
        - paragraph [ref=e56]: "No value was returned: Returns is None, so no destination received anything (caller from the exit). This is the exit’s configuration, not a failure."
    - region [ref=e57]:
      - heading "Execution limits" [level=2] [ref=e59]
      - generic [ref=e60]:
        - paragraph [ref=e61]: "Maximum node visits: 10. Run deadline: none."
        - paragraph [ref=e62]: "Structured completion: Unlimited."
        - paragraph [ref=e63]: Limits are pinned for this run. Gate pass limits and node watchdogs follow its pinned definition.
    - generic [ref=e64]:
      - paragraph [ref=e65]: History retained.
      - generic [ref=e66]:
        - button "Review delete-ready history" [ref=e67] [cursor=pointer]
        - button "Withdraw delete-ready mark" [ref=e69] [cursor=pointer]
        - generic [ref=e71]: 1 selected
    - region [ref=e72]:
      - heading "Execution context" [level=2] [ref=e74]
      - generic [ref=e75]:
        - paragraph [ref=e76]:
          - text: Independent patch 1440 [e42ee84d-1] v1 · version ID
          - code [ref=e77]: 01M3Y7RKG08PAHHFN9FXPXTNS1
        - button "Exact run record" [ref=e79] [cursor=pointer]
        - button "Pinned definition JSON" [ref=e85] [cursor=pointer]
    - region [ref=e90]:
      - heading "Finalization" [level=2] [ref=e92]
      - generic [ref=e93]:
        - status [ref=e94]: Fully finalized.
        - paragraph [ref=e95]: "Execution: succeeded. Delivery is tracked separately."
    - generic [ref=e96]:
      - region [ref=e97]:
        - heading "Timeline (10 events, complete)" [level=2] [ref=e99]
        - generic [ref=e100]:
          - generic [ref=e101]:
            - button "Load older" [disabled] [ref=e102]
            - button "Previous rows" [disabled] [ref=e104]
            - button "Next rows" [disabled] [ref=e106]
            - button "Load newer" [disabled] [ref=e108]
            - button "Follow live" [ref=e110] [cursor=pointer]
            - generic [ref=e112]: Showing events 1–10 of the retained window.
            - generic [ref=e113]: Following paused. Showing events 1–10 of the retained window.
          - generic [ref=e114]:
            - generic [ref=e115]:
              - text: Event sequence
              - spinbutton "Event sequence" [ref=e116]
            - button "Go to event" [ref=e117] [cursor=pointer]
          - list "Timeline" [ref=e119]:
            - listitem [ref=e120]:
              - button "#1 run.queued" [ref=e121] [cursor=pointer]:
                - generic [ref=e122]: "#1"
                - code [ref=e123]: run.queued
            - listitem [ref=e124]:
              - button "#2 run.started attempt 1" [ref=e125] [cursor=pointer]:
                - generic [ref=e126]: "#2"
                - code [ref=e127]: run.started
                - generic [ref=e128]: attempt 1
            - listitem [ref=e129]:
              - button "#3 node.started Start (start) (trigger) attempt 1" [ref=e130] [cursor=pointer]:
                - generic [ref=e131]: "#3"
                - code [ref=e132]: node.started
                - generic [ref=e133]: Start (start) (trigger) attempt 1
            - listitem [ref=e134]:
              - button "#4 node.finished Start (start) → out, 2 changes, 2 ms" [ref=e135] [cursor=pointer]:
                - generic [ref=e136]: "#4"
                - code [ref=e137]: node.finished
                - generic [ref=e138]: Start (start) → out, 2 changes, 2 ms
            - listitem [ref=e139]:
              - button "#5 node.started Recorded changes (mutate) (mutate) attempt 1" [ref=e140] [cursor=pointer]:
                - generic [ref=e141]: "#5"
                - code [ref=e142]: node.started
                - generic [ref=e143]: Recorded changes (mutate) (mutate) attempt 1
            - listitem [ref=e144]:
              - button "#6 node.finished Recorded changes (mutate) → out, 16 changes, 5 ms" [ref=e145] [cursor=pointer]:
                - generic [ref=e146]: "#6"
                - code [ref=e147]: node.finished
                - generic [ref=e148]: Recorded changes (mutate) → out, 16 changes, 5 ms
            - listitem [ref=e149]:
              - button "#7 node.started Done (done) (exit) attempt 1" [ref=e150] [cursor=pointer]:
                - generic [ref=e151]: "#7"
                - code [ref=e152]: node.started
                - generic [ref=e153]: Done (done) (exit) attempt 1
            - listitem [ref=e154]:
              - 'button "#8 exit.evaluated Done (done): Exited: success" [ref=e155] [cursor=pointer]':
                - generic [ref=e156]: "#8"
                - code [ref=e157]: exit.evaluated
                - generic [ref=e158]: "Done (done): Exited: success"
            - listitem [ref=e159]:
              - button "#9 node.finished Done (done), 0 changes, 2 ms" [ref=e160] [cursor=pointer]:
                - generic [ref=e161]: "#9"
                - code [ref=e162]: node.finished
                - generic [ref=e163]: Done (done), 0 changes, 2 ms
            - listitem [ref=e164]:
              - button "#10 run.finished succeeded (success)" [ref=e165] [cursor=pointer]:
                - generic [ref=e166]: "#10"
                - code [ref=e167]: run.finished
                - generic [ref=e168]: succeeded (success)
      - generic [ref=e169]:
        - 'button "Exact recorded event #6" [ref=e171] [cursor=pointer]'
        - generic [ref=e176]:
          - region [ref=e177]:
            - heading "Patch from Recorded changes (mutate)" [level=2] [ref=e179]
            - list "Patch diff" [ref=e182]:
              - listitem [ref=e183]:
                - generic [ref=e184]:
                  - generic [ref=e185]: add
                  - code [ref=e187]: /vars/items
                - generic [ref=e188]:
                  - generic [ref=e189]:
                    - generic [ref=e190]: Before
                    - generic "Value before /vars/items" [ref=e192]: (absent)
                  - generic [ref=e193]:
                    - generic [ref=e194]: Added value
                    - generic "Value after /vars/items" [ref=e196]: "[ \"seed\" ]"
              - listitem [ref=e197]:
                - generic [ref=e198]:
                  - generic [ref=e199]: add
                  - code [ref=e201]: /messages/-
                - generic [ref=e202]:
                  - generic [ref=e203]:
                    - generic [ref=e204]: Before
                    - generic "Value before /messages/-" [ref=e206]: (absent)
                  - generic [ref=e207]:
                    - generic [ref=e208]: Added value
                    - generic "Value after /messages/-" [ref=e210]: "{ \"id\": \"01M3Y7RKG08PAHHFN9FXPXTNS4\", \"role\": \"note\", \"content\": \"first α\", \"nodeId\": \"mutate\", \"ts\": \"2026-10-02T12:00:00.000Z\" }"
              - listitem [ref=e211]:
                - generic [ref=e212]:
                  - generic [ref=e213]: add
                  - code [ref=e215]: /messages/-
                - generic [ref=e216]:
                  - generic [ref=e217]:
                    - generic [ref=e218]: Before
                    - generic "Value before /messages/-" [ref=e220]: (absent)
                  - generic [ref=e221]:
                    - generic [ref=e222]: Added value
                    - generic [ref=e223]:
                      - region "Value after /messages/-" [ref=e224]: "{ \"id\": \"01M3Y7RKG08PAHHFN9FXPXTNS5\", \"role\": \"note\", \"content\": \"長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長\", \"nodeId\": \"mutate\", \"ts\": \"2026-10-02T12:00:00.000Z\" }"
                      - paragraph [ref=e225]:
                        - generic [ref=e226]: Showing all 6,133 characters.
                        - button "Show less of Value after /messages/-" [active] [ref=e227] [cursor=pointer]:
                          - generic [ref=e228]: Show less
              - listitem [ref=e229]:
                - generic [ref=e230]:
                  - generic [ref=e231]: add
                  - code [ref=e233]: /vars/items/-
                - generic [ref=e234]:
                  - generic [ref=e235]:
                    - generic [ref=e236]: Before
                    - generic "Value before /vars/items/-" [ref=e238]: (absent)
                  - generic [ref=e239]:
                    - generic [ref=e240]: Added value
                    - generic "Value after /vars/items/-" [ref=e242]: "null"
              - listitem [ref=e243]:
                - generic [ref=e244]:
                  - generic [ref=e245]: add
                  - code [ref=e247]: /vars/items/-
                - generic [ref=e248]:
                  - generic [ref=e249]:
                    - generic [ref=e250]: Before
                    - generic "Value before /vars/items/-" [ref=e252]: (absent)
                  - generic [ref=e253]:
                    - generic [ref=e254]: Added value
                    - generic "Value after /vars/items/-" [ref=e256]: "false"
              - listitem [ref=e257]:
                - generic [ref=e258]:
                  - generic [ref=e259]: add
                  - code [ref=e261]: /vars/items/-
                - generic [ref=e262]:
                  - generic [ref=e263]:
                    - generic [ref=e264]: Before
                    - generic "Value before /vars/items/-" [ref=e266]: (absent)
                  - generic [ref=e267]:
                    - generic [ref=e268]: Added value
                    - generic "Value after /vars/items/-" [ref=e270]: "0"
              - listitem [ref=e271]:
                - generic [ref=e272]:
                  - generic [ref=e273]: add
                  - code [ref=e275]: /vars/items/-
                - generic [ref=e276]:
                  - generic [ref=e277]:
                    - generic [ref=e278]: Before
                    - generic "Value before /vars/items/-" [ref=e280]: (absent)
                  - generic [ref=e281]:
                    - generic [ref=e282]: Added value
                    - generic "Value after /vars/items/-" [ref=e284]: "{ \"nested\": [ 1, false, [ \"α\", null ] ] }"
              - listitem [ref=e285]:
                - generic [ref=e286]:
                  - generic [ref=e287]: add
                  - code [ref=e289]: /vars/items/-
                - generic [ref=e290]:
                  - generic [ref=e291]:
                    - generic [ref=e292]: Before
                    - generic "Value before /vars/items/-" [ref=e294]: (absent)
                  - generic [ref=e295]:
                    - generic [ref=e296]: Added value
                    - generic "Value after /vars/items/-" [ref=e298]: "[ \"inner\" ]"
              - listitem [ref=e299]:
                - generic [ref=e300]:
                  - generic [ref=e301]: add
                  - code [ref=e303]: /vars/a~1b~0c
                - generic [ref=e304]:
                  - generic [ref=e305]:
                    - generic [ref=e306]: Before
                    - generic "Value before /vars/a~1b~0c" [ref=e308]: (absent)
                  - generic [ref=e309]:
                    - generic [ref=e310]: Added value
                    - generic "Value after /vars/a~1b~0c" [ref=e312]: "[]"
              - listitem [ref=e313]:
                - generic [ref=e314]:
                  - generic [ref=e315]: add
                  - code [ref=e317]: /vars/a~1b~0c/-
                - generic [ref=e318]:
                  - generic [ref=e319]:
                    - generic [ref=e320]: Before
                    - generic "Value before /vars/a~1b~0c/-" [ref=e322]: (absent)
                  - generic [ref=e323]:
                    - generic [ref=e324]: Added value
                    - generic "Value after /vars/a~1b~0c/-" [ref=e326]: "\"escaped\""
              - listitem [ref=e327]:
                - generic [ref=e328]:
                  - generic [ref=e329]: add
                  - code [ref=e331]: /vars/object
                - generic [ref=e332]:
                  - generic [ref=e333]:
                    - generic [ref=e334]: Before
                    - generic "Value before /vars/object" [ref=e336]: (absent)
                  - generic [ref=e337]:
                    - generic [ref=e338]: Added value
                    - generic "Value after /vars/object" [ref=e340]: "{ \"-\": \"old\" }"
              - listitem [ref=e341]:
                - generic [ref=e342]:
                  - generic [ref=e343]: replace
                  - code [ref=e345]: /vars/object/-
                - generic [ref=e346]:
                  - generic [ref=e347]:
                    - generic [ref=e348]: Before
                    - generic "Value before /vars/object/-" [ref=e350]: (absent)
                  - generic [ref=e351]:
                    - generic [ref=e352]: After
                    - generic "Value after /vars/object/-" [ref=e354]: "\"new\""
              - listitem [ref=e355]:
                - generic [ref=e356]:
                  - generic [ref=e357]: add
                  - code [ref=e359]: /vars/replaced
                - generic [ref=e360]:
                  - generic [ref=e361]:
                    - generic [ref=e362]: Before
                    - generic "Value before /vars/replaced" [ref=e364]: (absent)
                  - generic [ref=e365]:
                    - generic [ref=e366]: Added value
                    - generic "Value after /vars/replaced" [ref=e368]: "\"before\""
              - listitem [ref=e369]:
                - generic [ref=e370]:
                  - generic [ref=e371]: replace
                  - code [ref=e373]: /vars/replaced
                - generic [ref=e374]:
                  - generic [ref=e375]:
                    - generic [ref=e376]: Before
                    - generic "Value before /vars/replaced" [ref=e378]: (absent)
                  - generic [ref=e379]:
                    - generic [ref=e380]: After
                    - generic "Value after /vars/replaced" [ref=e382]: "\"after\""
              - listitem [ref=e383]:
                - generic [ref=e384]:
                  - generic [ref=e385]: add
                  - code [ref=e387]: /vars/removed
                - generic [ref=e388]:
                  - generic [ref=e389]:
                    - generic [ref=e390]: Before
                    - generic "Value before /vars/removed" [ref=e392]: (absent)
                  - generic [ref=e393]:
                    - generic [ref=e394]: Added value
                    - generic "Value after /vars/removed" [ref=e396]: "\"gone\""
              - listitem [ref=e397]:
                - generic [ref=e398]:
                  - generic [ref=e399]: remove
                  - code [ref=e401]: /vars/removed
                - generic [ref=e402]:
                  - generic [ref=e403]:
                    - generic [ref=e404]: Before
                    - generic "Value before /vars/removed" [ref=e406]: (absent)
                  - generic [ref=e407]:
                    - generic [ref=e408]: After
                    - generic "Value after /vars/removed" [ref=e410]: (absent)
          - region [ref=e411]:
            - heading "Thread at event 6" [level=2] [ref=e413]
            - generic [ref=e415]:
              - generic [ref=e416]:
                - heading "Messages (2)" [level=3] [ref=e417]
                - list "Messages" [ref=e418]:
                  - listitem [ref=e419]:
                    - generic [ref=e420]:
                      - generic [ref=e421]: note
                      - code [ref=e423]: Recorded changes (mutate)
                    - generic [ref=e424]: first α
                  - listitem [ref=e426]:
                    - generic [ref=e427]:
                      - generic [ref=e428]: note
                      - code [ref=e430]: Recorded changes (mutate)
                    - generic [ref=e431]:
                      - generic [ref=e432]: 長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長…
                      - paragraph [ref=e433]:
                        - generic [ref=e434]: Showing the first 4,096 of 6,000 characters.
                        - button "Show all of Message 01M3Y7RKG08PAHHFN9FXPXTNS5 content" [ref=e435] [cursor=pointer]:
                          - generic [ref=e436]: Show all
              - generic [ref=e437]:
                - heading "Variables" [level=3] [ref=e438]
                - generic "Variables" [ref=e440]: "{ \"items\": [ \"seed\", null, false, 0, { \"nested\": [ 1, false, [ \"α\", null ] ] }, [ \"inner\" ] ], \"a/b~c\": [ \"escaped\" ], \"object\": { \"-\": \"new\" }, \"replaced\": \"after\" }"
              - button "Full thread JSON" [ref=e442] [cursor=pointer]
        - paragraph [ref=e447]: Activity below covers the retained history window. Earlier activity is available through Load older.
        - button "Node progress (1 nodes)" [ref=e449] [cursor=pointer]
```

# Test source

```ts
  27  |     heldObservation++;
  28  |     await observationGate;
  29  |     const response = await route.fetch();
  30  |     await route.fulfill({ response });
  31  |     returnedObservation++;
  32  |   });
  33  |   await page.route((url) => url.pathname === `/runs/${run.id}`, async (route) => {
  34  |     runReads++;
  35  |     if (runReads > 1) { heldRun++; await runGate; }
  36  |     const response = await route.fetch();
  37  |     const { finishedAt: _finishedAt, finalizedAt: _finalizedAt, outcome: _outcome, result: _result, ...row } = await response.json() as Record<string, unknown>;
  38  |     await route.fulfill({ response, json: { ...row, status: 'running', currentNodeId: 'done', lastEventSeq: runReads === 1 ? finished.seq - 1 : finished.seq } });
  39  |     returnedRun++;
  40  |   });
  41  |   try {
  42  |     await page.goto(`/app/runs/${run.id}`);
  43  |     const timeline = page.getByRole('list', { name: 'Timeline' });
  44  |     await expect(timeline.getByRole('button', { name: /run\.finished.*succeeded/ })).toBeVisible();
  45  |     const header = page.locator('header').filter({ has: page.getByRole('heading', { name: `Run ${run.id}` }) });
  46  |     await expect.poll(() => heldRun).toBeGreaterThan(0);
  47  |     expect(heldObservation).toBeGreaterThan(0);
  48  |     expect(returnedObservation).toBe(0);
  49  |     await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  50  |     await page.screenshot({ path: join(evidence, 'S1-both-models-held.png'), fullPage: true });
  51  |     releaseRun();
  52  |     await expect.poll(() => returnedRun).toBeGreaterThan(1);
  53  |     await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  54  |     expect(returnedObservation).toBe(0);
  55  |     await expect(header.locator('[data-status]')).toHaveAttribute('data-status', 'succeeded');
  56  |     await expect(header.getByText(/^at /)).toHaveCount(0);
  57  |     await page.screenshot({ path: join(evidence, 'S2-equal-sequence-stale-returned.png'), fullPage: true });
  58  |     await writeFile(join(evidence, 'S1-S2-schedule.json'), JSON.stringify({ runId: run.id, terminal: finished, runReads, heldRun, returnedRun, heldObservation, returnedObservation }, null, 2));
  59  |     await writeFile(join(evidence, 'S2-rendered.html'), await page.content());
  60  |   } finally { releaseRun(); releaseObservation(); await page.unrouteAll({ behavior: 'wait' }); }
  61  | });
  62  | 
  63  | for (const width of [1440, 390]) {
  64  |   test(`independent P1-P5: real recorded repeated appends and non-add diffs at ${width}px`, async ({ page, request }) => {
  65  |     const source = minimalLoop();
  66  |     const longMessage = '長'.repeat(6000);
  67  |     const definition = {
  68  |       ...source, name: uniqueLoopName(`Independent patch ${width}`),
  69  |       nodes: [source.nodes[0]!, {
  70  |         id: 'mutate', kind: 'mutate', label: 'Recorded changes', config: { operations: [
  71  |           { op: 'set', path: '/vars/items', value: { kind: 'literal', value: ['seed'] } },
  72  |           { op: 'append-message', role: 'note', content: 'first α' },
  73  |           { op: 'append-message', role: 'note', content: longMessage },
  74  |           ...[null, false, 0, { nested: [1, false, ['α', null]] }, ['inner']].map((value) => ({ op: 'set', path: '/vars/items/-', value: { kind: 'literal', value } })),
  75  |           { op: 'set', path: '/vars/a~1b~0c', value: { kind: 'literal', value: [] } },
  76  |           { op: 'set', path: '/vars/a~1b~0c/-', value: { kind: 'literal', value: 'escaped' } },
  77  |           { op: 'set', path: '/vars/object', value: { kind: 'literal', value: { '-': 'old' } } },
  78  |           { op: 'set', path: '/vars/object/-', value: { kind: 'literal', value: 'new' } },
  79  |           { op: 'set', path: '/vars/replaced', value: { kind: 'literal', value: 'before' } },
  80  |           { op: 'set', path: '/vars/replaced', value: { kind: 'literal', value: 'after' } },
  81  |           { op: 'set', path: '/vars/removed', value: { kind: 'literal', value: 'gone' } },
  82  |           { op: 'delete', path: '/vars/removed' },
  83  |         ] }, ui: { x: 260, y: 80 },
  84  |       }, source.nodes[1]!],
  85  |       edges: [
  86  |         { id: 'qa1', from: { node: 'start', port: 'out' }, to: { node: 'mutate' } },
  87  |         { id: 'qa2', from: { node: 'mutate', port: 'out' }, to: { node: 'done' } },
  88  |       ],
  89  |     };
  90  |     const loopId = await publishLoop(request, definition);
  91  |     const started = await request.post(`/loops/${loopId}/runs`, { data: { input: null } });
  92  |     expect(started.status()).toBe(202);
  93  |     const { run } = await started.json() as { run: { id: string } };
  94  |     await expect.poll(async () => (await (await request.get(`/runs/${run.id}`)).json() as { status: string }).status).toBe('succeeded');
  95  |     const events = (await (await request.get(`/runs/${run.id}/events`)).json() as { items: RunEvent[] }).items;
  96  |     const completed = events.find((event) => event.type === 'node.finished' && event.nodeId === 'mutate');
  97  |     if (completed?.type !== 'node.finished') throw new Error('Missing real recorded mutation completion');
  98  |     await writeFile(join(evidence, `P-${width}-recorded-events.json`), JSON.stringify(events, null, 2));
  99  |     await page.setViewportSize({ width, height: 900 });
  100 |     await page.goto(`/app/runs/${run.id}`);
  101 |     await page.getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /node\.finished Recorded changes \(mutate\)/ }).click();
  102 |     const diff = page.getByRole('list', { name: 'Patch diff' });
  103 |     await expect(diff).toBeVisible();
  104 |     const rows = diff.getByRole('listitem');
  105 |     await expect(rows).toHaveCount(completed.patch.length);
  106 |     let longIndex = -1;
  107 |     for (const [index, operation] of completed.patch.entries()) {
  108 |       const row = rows.nth(index);
  109 |       if (operation.op === 'add') {
  110 |         const text = JSON.stringify(operation.value, null, 2);
  111 |         if (text.length > 1024) {
  112 |           longIndex = index;
  113 |           await row.getByRole('button', { name: `Show all of Value after ${operation.path}`, exact: true }).click();
  114 |         }
  115 |         await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText(text);
  116 |         if (operation.path === '/messages/-' || operation.path === '/vars/items/-' || operation.path === '/vars/a~1b~0c/-') {
  117 |           await expect(row.getByLabel(`Value before ${operation.path}`, { exact: true })).toHaveText('(absent)');
  118 |         }
  119 |       }
  120 |       if (operation.op === 'replace' && operation.path === '/vars/object/-') {
  121 |         await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText('"new"');
  122 |       }
  123 |       if (operation.op === 'remove') await expect(row.getByLabel(`Value after ${operation.path}`, { exact: true })).toHaveText('(absent)');
  124 |     }
  125 |     expect(longIndex).toBeGreaterThanOrEqual(0);
  126 |     const longRow = rows.nth(longIndex);
> 127 |     const downloadPromise = page.waitForEvent('download');
      |                                  ^ Error: page.waitForEvent: Test timeout of 60000ms exceeded.
  128 |     await longRow.getByRole('button', { name: /^Download Value after .* as JSON$/ }).click();
  129 |     const download = await downloadPromise;
  130 |     const downloadedPath = join(evidence, `P-${width}-exact-appended-message.json`);
  131 |     await download.saveAs(downloadedPath);
  132 |     const recordedLong = completed.patch[longIndex]!;
  133 |     if (recordedLong.op !== 'add') throw new Error('Expected recorded add');
  134 |     expect(JSON.parse(await readFile(downloadedPath, 'utf8'))).toEqual(recordedLong.value);
  135 |     const dimensions = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: window.innerWidth }));
  136 |     expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  137 |     await page.screenshot({ path: join(evidence, `P-${width}-rendered-diffs.png`), fullPage: true });
  138 |     await writeFile(join(evidence, `P-${width}-rendered.html`), await page.content());
  139 |     await page.getByRole('list', { name: 'Timeline' }).getByRole('button', { name: /node\.finished Start \(start\)/ }).click();
  140 |     await expect(page.getByRole('list', { name: 'Patch diff' })).toBeVisible();
  141 |     await expect(page.getByRole('list', { name: 'Patch diff' }).getByText('/messages/-', { exact: true })).toHaveCount(0);
  142 |   });
  143 | }
  144 | 
```