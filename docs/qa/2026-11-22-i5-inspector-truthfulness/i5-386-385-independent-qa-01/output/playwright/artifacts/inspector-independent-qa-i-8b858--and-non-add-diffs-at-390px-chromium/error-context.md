# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: inspector-independent-qa.spec.ts >> independent P1-P5: real recorded repeated appends and non-add diffs at 390px
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
    - button "Menu" [ref=e22] [cursor=pointer]
  - generic [ref=e25]:
    - banner [ref=e26]:
      - generic [ref=e27]:
        - heading "Run 01M3Y7RKG08PAHHFN9FXPXTNS8" [level=1] [ref=e28]:
          - text: Run
          - generic [ref=e29]: 01M3Y7RKG08PAHHFN9FXPXTNS8
        - generic [ref=e30]: succeeded
      - generic [ref=e34]:
        - link "loop" [ref=e35] [cursor=pointer]:
          - /url: /app/loops/01M3Y7RKG08PAHHFN9FXPXTNS6/edit
        - link "child runs" [ref=e36] [cursor=pointer]:
          - /url: /app/runs?parent=01M3Y7RKG08PAHHFN9FXPXTNS8
      - generic [ref=e38]:
        - generic [ref=e39]:
          - button "Resume" [disabled]
          - button "Replay..." [ref=e40] [cursor=pointer]
        - paragraph [ref=e42]: "Resume unavailable: This run has finished. Resume only continues paused runs or supported failures."
    - region [ref=e43]:
      - heading "Exit evaluation" [level=2] [ref=e45]
      - generic [ref=e46]:
        - paragraph [ref=e47]: "Done (done): Exited: success"
        - paragraph [ref=e48]: "No value was returned: Returns is None, so no destination received anything (caller from the exit). This is the exit’s configuration, not a failure."
    - region [ref=e49]:
      - heading "Execution limits" [level=2] [ref=e51]
      - generic [ref=e52]:
        - paragraph [ref=e53]: "Maximum node visits: 10. Run deadline: none."
        - paragraph [ref=e54]: "Structured completion: Unlimited."
        - paragraph [ref=e55]: Limits are pinned for this run. Gate pass limits and node watchdogs follow its pinned definition.
    - generic [ref=e56]:
      - paragraph [ref=e57]: History retained.
      - generic [ref=e58]:
        - button "Review delete-ready history" [ref=e59] [cursor=pointer]
        - button "Withdraw delete-ready mark" [ref=e61] [cursor=pointer]
        - generic [ref=e63]: 1 selected
    - region [ref=e64]:
      - heading "Execution context" [level=2] [ref=e66]
      - generic [ref=e67]:
        - paragraph [ref=e68]:
          - text: Independent patch 390 [ad278348-1] v1 · version ID
          - code [ref=e69]: 01M3Y7RKG08PAHHFN9FXPXTNS7
        - button "Exact run record" [ref=e71] [cursor=pointer]
        - button "Pinned definition JSON" [ref=e77] [cursor=pointer]
    - region [ref=e82]:
      - heading "Finalization" [level=2] [ref=e84]
      - generic [ref=e85]:
        - status [ref=e86]: Fully finalized.
        - paragraph [ref=e87]: "Execution: succeeded. Delivery is tracked separately."
    - generic [ref=e88]:
      - region [ref=e89]:
        - heading "Timeline (10 events, complete)" [level=2] [ref=e91]
        - generic [ref=e92]:
          - generic [ref=e93]:
            - button "Load older" [disabled] [ref=e94]
            - button "Previous rows" [disabled] [ref=e96]
            - button "Next rows" [disabled] [ref=e98]
            - button "Load newer" [disabled] [ref=e100]
            - button "Follow live" [ref=e102] [cursor=pointer]
            - generic [ref=e104]: Showing events 1–10 of the retained window.
            - generic [ref=e105]: Following paused. Showing events 1–10 of the retained window.
          - generic [ref=e106]:
            - generic [ref=e107]:
              - text: Event sequence
              - spinbutton "Event sequence" [ref=e108]
            - button "Go to event" [ref=e109] [cursor=pointer]
          - list "Timeline" [ref=e111]:
            - listitem [ref=e112]:
              - button "#1 run.queued" [ref=e113] [cursor=pointer]:
                - generic [ref=e114]: "#1"
                - code [ref=e115]: run.queued
            - listitem [ref=e116]:
              - button "#2 run.started attempt 1" [ref=e117] [cursor=pointer]:
                - generic [ref=e118]: "#2"
                - code [ref=e119]: run.started
                - generic [ref=e120]: attempt 1
            - listitem [ref=e121]:
              - button "#3 node.started Start (start) (trigger) attempt 1" [ref=e122] [cursor=pointer]:
                - generic [ref=e123]: "#3"
                - code [ref=e124]: node.started
                - generic [ref=e125]: Start (start) (trigger) attempt 1
            - listitem [ref=e126]:
              - button "#4 node.finished Start (start) → out, 2 changes, 4 ms" [ref=e127] [cursor=pointer]:
                - generic [ref=e128]: "#4"
                - code [ref=e129]: node.finished
                - generic [ref=e130]: Start (start) → out, 2 changes, 4 ms
            - listitem [ref=e131]:
              - button "#5 node.started Recorded changes (mutate) (mutate) attempt 1" [ref=e132] [cursor=pointer]:
                - generic [ref=e133]: "#5"
                - code [ref=e134]: node.started
                - generic [ref=e135]: Recorded changes (mutate) (mutate) attempt 1
            - listitem [ref=e136]:
              - button "#6 node.finished Recorded changes (mutate) → out, 16 changes, 6 ms" [ref=e137] [cursor=pointer]:
                - generic [ref=e138]: "#6"
                - code [ref=e139]: node.finished
                - generic [ref=e140]: Recorded changes (mutate) → out, 16 changes, 6 ms
            - listitem [ref=e141]:
              - button "#7 node.started Done (done) (exit) attempt 1" [ref=e142] [cursor=pointer]:
                - generic [ref=e143]: "#7"
                - code [ref=e144]: node.started
                - generic [ref=e145]: Done (done) (exit) attempt 1
            - listitem [ref=e146]:
              - 'button "#8 exit.evaluated Done (done): Exited: success" [ref=e147] [cursor=pointer]':
                - generic [ref=e148]: "#8"
                - code [ref=e149]: exit.evaluated
                - generic [ref=e150]: "Done (done): Exited: success"
            - listitem [ref=e151]:
              - button "#9 node.finished Done (done), 0 changes, 2 ms" [ref=e152] [cursor=pointer]:
                - generic [ref=e153]: "#9"
                - code [ref=e154]: node.finished
                - generic [ref=e155]: Done (done), 0 changes, 2 ms
            - listitem [ref=e156]:
              - button "#10 run.finished succeeded (success)" [ref=e157] [cursor=pointer]:
                - generic [ref=e158]: "#10"
                - code [ref=e159]: run.finished
                - generic [ref=e160]: succeeded (success)
      - generic [ref=e161]:
        - 'button "Exact recorded event #6" [ref=e163] [cursor=pointer]'
        - generic [ref=e168]:
          - region [ref=e169]:
            - heading "Patch from Recorded changes (mutate)" [level=2] [ref=e171]
            - list "Patch diff" [ref=e174]:
              - listitem [ref=e175]:
                - generic [ref=e176]:
                  - generic [ref=e177]: add
                  - code [ref=e179]: /vars/items
                - generic [ref=e180]:
                  - generic [ref=e181]:
                    - generic [ref=e182]: Before
                    - generic "Value before /vars/items" [ref=e184]: (absent)
                  - generic [ref=e185]:
                    - generic [ref=e186]: Added value
                    - generic "Value after /vars/items" [ref=e188]: "[ \"seed\" ]"
              - listitem [ref=e189]:
                - generic [ref=e190]:
                  - generic [ref=e191]: add
                  - code [ref=e193]: /messages/-
                - generic [ref=e194]:
                  - generic [ref=e195]:
                    - generic [ref=e196]: Before
                    - generic "Value before /messages/-" [ref=e198]: (absent)
                  - generic [ref=e199]:
                    - generic [ref=e200]: Added value
                    - generic "Value after /messages/-" [ref=e202]: "{ \"id\": \"01M3Y7RKG08PAHHFN9FXPXTNSA\", \"role\": \"note\", \"content\": \"first α\", \"nodeId\": \"mutate\", \"ts\": \"2026-10-02T12:00:00.000Z\" }"
              - listitem [ref=e203]:
                - generic [ref=e204]:
                  - generic [ref=e205]: add
                  - code [ref=e207]: /messages/-
                - generic [ref=e208]:
                  - generic [ref=e209]:
                    - generic [ref=e210]: Before
                    - generic "Value before /messages/-" [ref=e212]: (absent)
                  - generic [ref=e213]:
                    - generic [ref=e214]: Added value
                    - generic [ref=e215]:
                      - region "Value after /messages/-" [ref=e216]: "{ \"id\": \"01M3Y7RKG08PAHHFN9FXPXTNSB\", \"role\": \"note\", \"content\": \"長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長\", \"nodeId\": \"mutate\", \"ts\": \"2026-10-02T12:00:00.000Z\" }"
                      - paragraph [ref=e217]:
                        - generic [ref=e218]: Showing all 6,133 characters.
                        - button "Show less of Value after /messages/-" [active] [ref=e219] [cursor=pointer]:
                          - generic [ref=e220]: Show less
              - listitem [ref=e221]:
                - generic [ref=e222]:
                  - generic [ref=e223]: add
                  - code [ref=e225]: /vars/items/-
                - generic [ref=e226]:
                  - generic [ref=e227]:
                    - generic [ref=e228]: Before
                    - generic "Value before /vars/items/-" [ref=e230]: (absent)
                  - generic [ref=e231]:
                    - generic [ref=e232]: Added value
                    - generic "Value after /vars/items/-" [ref=e234]: "null"
              - listitem [ref=e235]:
                - generic [ref=e236]:
                  - generic [ref=e237]: add
                  - code [ref=e239]: /vars/items/-
                - generic [ref=e240]:
                  - generic [ref=e241]:
                    - generic [ref=e242]: Before
                    - generic "Value before /vars/items/-" [ref=e244]: (absent)
                  - generic [ref=e245]:
                    - generic [ref=e246]: Added value
                    - generic "Value after /vars/items/-" [ref=e248]: "false"
              - listitem [ref=e249]:
                - generic [ref=e250]:
                  - generic [ref=e251]: add
                  - code [ref=e253]: /vars/items/-
                - generic [ref=e254]:
                  - generic [ref=e255]:
                    - generic [ref=e256]: Before
                    - generic "Value before /vars/items/-" [ref=e258]: (absent)
                  - generic [ref=e259]:
                    - generic [ref=e260]: Added value
                    - generic "Value after /vars/items/-" [ref=e262]: "0"
              - listitem [ref=e263]:
                - generic [ref=e264]:
                  - generic [ref=e265]: add
                  - code [ref=e267]: /vars/items/-
                - generic [ref=e268]:
                  - generic [ref=e269]:
                    - generic [ref=e270]: Before
                    - generic "Value before /vars/items/-" [ref=e272]: (absent)
                  - generic [ref=e273]:
                    - generic [ref=e274]: Added value
                    - generic "Value after /vars/items/-" [ref=e276]: "{ \"nested\": [ 1, false, [ \"α\", null ] ] }"
              - listitem [ref=e277]:
                - generic [ref=e278]:
                  - generic [ref=e279]: add
                  - code [ref=e281]: /vars/items/-
                - generic [ref=e282]:
                  - generic [ref=e283]:
                    - generic [ref=e284]: Before
                    - generic "Value before /vars/items/-" [ref=e286]: (absent)
                  - generic [ref=e287]:
                    - generic [ref=e288]: Added value
                    - generic "Value after /vars/items/-" [ref=e290]: "[ \"inner\" ]"
              - listitem [ref=e291]:
                - generic [ref=e292]:
                  - generic [ref=e293]: add
                  - code [ref=e295]: /vars/a~1b~0c
                - generic [ref=e296]:
                  - generic [ref=e297]:
                    - generic [ref=e298]: Before
                    - generic "Value before /vars/a~1b~0c" [ref=e300]: (absent)
                  - generic [ref=e301]:
                    - generic [ref=e302]: Added value
                    - generic "Value after /vars/a~1b~0c" [ref=e304]: "[]"
              - listitem [ref=e305]:
                - generic [ref=e306]:
                  - generic [ref=e307]: add
                  - code [ref=e309]: /vars/a~1b~0c/-
                - generic [ref=e310]:
                  - generic [ref=e311]:
                    - generic [ref=e312]: Before
                    - generic "Value before /vars/a~1b~0c/-" [ref=e314]: (absent)
                  - generic [ref=e315]:
                    - generic [ref=e316]: Added value
                    - generic "Value after /vars/a~1b~0c/-" [ref=e318]: "\"escaped\""
              - listitem [ref=e319]:
                - generic [ref=e320]:
                  - generic [ref=e321]: add
                  - code [ref=e323]: /vars/object
                - generic [ref=e324]:
                  - generic [ref=e325]:
                    - generic [ref=e326]: Before
                    - generic "Value before /vars/object" [ref=e328]: (absent)
                  - generic [ref=e329]:
                    - generic [ref=e330]: Added value
                    - generic "Value after /vars/object" [ref=e332]: "{ \"-\": \"old\" }"
              - listitem [ref=e333]:
                - generic [ref=e334]:
                  - generic [ref=e335]: replace
                  - code [ref=e337]: /vars/object/-
                - generic [ref=e338]:
                  - generic [ref=e339]:
                    - generic [ref=e340]: Before
                    - generic "Value before /vars/object/-" [ref=e342]: (absent)
                  - generic [ref=e343]:
                    - generic [ref=e344]: After
                    - generic "Value after /vars/object/-" [ref=e346]: "\"new\""
              - listitem [ref=e347]:
                - generic [ref=e348]:
                  - generic [ref=e349]: add
                  - code [ref=e351]: /vars/replaced
                - generic [ref=e352]:
                  - generic [ref=e353]:
                    - generic [ref=e354]: Before
                    - generic "Value before /vars/replaced" [ref=e356]: (absent)
                  - generic [ref=e357]:
                    - generic [ref=e358]: Added value
                    - generic "Value after /vars/replaced" [ref=e360]: "\"before\""
              - listitem [ref=e361]:
                - generic [ref=e362]:
                  - generic [ref=e363]: replace
                  - code [ref=e365]: /vars/replaced
                - generic [ref=e366]:
                  - generic [ref=e367]:
                    - generic [ref=e368]: Before
                    - generic "Value before /vars/replaced" [ref=e370]: (absent)
                  - generic [ref=e371]:
                    - generic [ref=e372]: After
                    - generic "Value after /vars/replaced" [ref=e374]: "\"after\""
              - listitem [ref=e375]:
                - generic [ref=e376]:
                  - generic [ref=e377]: add
                  - code [ref=e379]: /vars/removed
                - generic [ref=e380]:
                  - generic [ref=e381]:
                    - generic [ref=e382]: Before
                    - generic "Value before /vars/removed" [ref=e384]: (absent)
                  - generic [ref=e385]:
                    - generic [ref=e386]: Added value
                    - generic "Value after /vars/removed" [ref=e388]: "\"gone\""
              - listitem [ref=e389]:
                - generic [ref=e390]:
                  - generic [ref=e391]: remove
                  - code [ref=e393]: /vars/removed
                - generic [ref=e394]:
                  - generic [ref=e395]:
                    - generic [ref=e396]: Before
                    - generic "Value before /vars/removed" [ref=e398]: (absent)
                  - generic [ref=e399]:
                    - generic [ref=e400]: After
                    - generic "Value after /vars/removed" [ref=e402]: (absent)
          - region [ref=e403]:
            - heading "Thread at event 6" [level=2] [ref=e405]
            - generic [ref=e407]:
              - generic [ref=e408]:
                - heading "Messages (2)" [level=3] [ref=e409]
                - list "Messages" [ref=e410]:
                  - listitem [ref=e411]:
                    - generic [ref=e412]:
                      - generic [ref=e413]: note
                      - code [ref=e415]: Recorded changes (mutate)
                    - generic [ref=e416]: first α
                  - listitem [ref=e418]:
                    - generic [ref=e419]:
                      - generic [ref=e420]: note
                      - code [ref=e422]: Recorded changes (mutate)
                    - generic [ref=e423]:
                      - generic [ref=e424]: 長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長長…
                      - paragraph [ref=e425]:
                        - generic [ref=e426]: Showing the first 4,096 of 6,000 characters.
                        - button "Show all of Message 01M3Y7RKG08PAHHFN9FXPXTNSB content" [ref=e427] [cursor=pointer]:
                          - generic [ref=e428]: Show all
              - generic [ref=e429]:
                - heading "Variables" [level=3] [ref=e430]
                - generic "Variables" [ref=e432]: "{ \"items\": [ \"seed\", null, false, 0, { \"nested\": [ 1, false, [ \"α\", null ] ] }, [ \"inner\" ] ], \"a/b~c\": [ \"escaped\" ], \"object\": { \"-\": \"new\" }, \"replaced\": \"after\" }"
              - button "Full thread JSON" [ref=e434] [cursor=pointer]
        - paragraph [ref=e439]: Activity below covers the retained history window. Earlier activity is available through Load older.
        - button "Node progress (1 nodes)" [ref=e441] [cursor=pointer]
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