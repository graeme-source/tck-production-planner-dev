# Survey: formatted intro + final offer page — Shopify theme change

**Status:** NOT applied. Needs Graeme's approval (it's a Shopify theme write).
Written 2026-10-16 alongside the planner change (migration 0201). Objective I.

## Why a theme change is needed

The public survey page (`thecalzonekitchen.co.uk/pages/feedback?s=<token>`)
is drawn by the **Shopify theme**, not by the planner:

- `tck-theme/assets/tck-survey.js` — fetches
  `GET {data-api}/api/public/surveys/:token` and builds the page with DOM
  calls. The intro is put in with `textContent` (in `renderSurvey()`, the
  `el("p", "tck-survey__intro", introText)` line), so line breaks and any
  formatting are lost.
- `tck-theme/sections/tck-survey.liquid` — the container and the CSS.

The planner API is **backward compatible**: `intro` is still the plain text
(now with blank lines between paragraphs), so the live theme keeps working
untouched. Two new fields are added:

| field | what it is |
|---|---|
| `intro_html` | the intro as HTML, sanitised on the server on save **and again on output** (allow-list below). Older plain-text intros come back as `<p>` paragraphs. `null` = no intro. |
| `final_page` | `null` when the survey's final page is off (end exactly as today), otherwise `{ heading, html, button: { label, url } \| null, offer }`. `html` is sanitised like `intro_html`; `button.url` is always `https://` on thecalzonekitchen.co.uk; `offer` is this week's offer wording from the email plan, or `null`. |

### Server allow-list (artifacts/api-server/src/lib/survey-intro.ts)

`p, br, strong, em, u, h2, h3, ul, ol, li, a, span` — nothing else.
`a`: `href` (http/https/mailto only) and forced `rel="noopener noreferrer" target="_blank"`.
`span`: `class` from `tck-font-heading tck-font-serif tck-size-small tck-size-large`.
`p/h2/h3`: `class` from `tck-align-left tck-align-center`.
No `style` attributes, no event handlers, no images, iframes, forms or SVG.

Because the HTML is cleaned twice on our side, the theme can insert it with
`innerHTML`. Insert ONLY `intro_html` and `final_page.html` that way;
everything else stays `textContent`.

## 1. `assets/tck-survey.js`

### a) Intro — replace the block that adds the intro (in `renderSurvey`)

Current:

```js
    if (introText) {
      intro = el("p", "tck-survey__intro", introText);
      head.appendChild(intro);
    }
```

New:

```js
    if (!followUp && survey.intro_html) {
      // Sanitised by the planner API (strict allow-list, re-applied on output).
      intro = el("div", "tck-survey__intro tck-rich");
      intro.innerHTML = survey.intro_html;
      head.appendChild(intro);
    } else if (introText) {
      intro = el("p", "tck-survey__intro", introText);
      head.appendChild(intro);
    }
```

(The "Welcome back" follow-up text stays plain, as now.)

### b) Final page — add this helper next to `message()`

```js
  function finalPage(page) {
    container.innerHTML = "";
    var wrap = el("div", "tck-survey__final");
    if (page.heading) wrap.appendChild(el("h2", "tck-survey__final-title custom-font", page.heading));
    if (page.html) {
      var body = el("div", "tck-survey__final-body tck-rich");
      body.innerHTML = page.html; // sanitised by the planner API
      wrap.appendChild(body);
    }
    if (page.offer) {
      var offer = el("div", "tck-survey__final-offer");
      offer.appendChild(el("p", "tck-survey__final-offer-label", "This week's offer"));
      offer.appendChild(el("p", "tck-survey__final-offer-text", page.offer));
      wrap.appendChild(offer);
    }
    if (page.button && /^https:\/\/(www\.)?thecalzonekitchen\.co\.uk\//.test(page.button.url)) {
      var a = el("a", "tck-survey__final-btn", page.button.label);
      a.href = page.button.url;
      wrap.appendChild(a);
    }
    container.appendChild(wrap);
    window.scrollTo({ top: container.getBoundingClientRect().top + window.pageYOffset - 40, behavior: "smooth" });
  }
```

(The button opens in the same tab on purpose: it's our own shop.)

### c) Show it after a successful submit — in the submit `.then(function (res) { … })`

Current:

```js
          if (followUp) {
            message("Lovely — thanks!", "We've added your thoughts on the ones you tried.");
          } else {
            message("Thank you!", "Your feedback goes straight to our kitchen and genuinely shapes what we bake next.");
          }
```

New:

```js
          if (survey.final_page) {
            finalPage(survey.final_page);
          } else if (followUp) {
            message("Lovely — thanks!", "We've added your thoughts on the ones you tried.");
          } else {
            message("Thank you!", "Your feedback goes straight to our kitchen and genuinely shapes what we bake next.");
          }
```

The 409 "already got your answers" path is unchanged.

## 2. `sections/tck-survey.liquid` — add to the `<style>` block

Uses the theme's own font variables (`--header-font-stack` = Swiss 721
Rounded, `--body-font-stack` = Geometric 415) — no new font downloads.
Serif is the system Georgia. Keep in step with
`artifacts/production-planner/src/components/survey-rich-text.css`.

```css
  /* Formatted survey text from the planner (intro + final page). */
  .tck-rich { line-height: 1.6; text-align: center; overflow-wrap: anywhere; }
  .tck-rich p { margin: 0 0 .75em; }
  .tck-rich > :last-child { margin-bottom: 0; }
  .tck-rich h2, .tck-rich h3 {
    font-family: var(--header-font-stack); font-weight: var(--header-font-weight);
    line-height: 1.25; margin: .6em 0 .4em;
  }
  .tck-rich h2 { font-size: 1.35em; }
  .tck-rich h3 { font-size: 1.12em; }
  .tck-rich > h2:first-child, .tck-rich > h3:first-child { margin-top: 0; }
  .tck-rich ul, .tck-rich ol { display: inline-block; text-align: left; margin: 0 0 .75em; padding-left: 1.4em; }
  .tck-rich ul { list-style: disc; }
  .tck-rich ol { list-style: decimal; }
  .tck-rich li { margin: .2em 0; }
  .tck-rich li p { margin: 0; }
  .tck-rich strong { font-weight: 700; }
  .tck-rich a { color: inherit; text-decoration: underline; text-underline-offset: 2px; }
  .tck-rich .tck-align-left { text-align: left; }
  .tck-rich .tck-align-center { text-align: center; }
  .tck-font-heading { font-family: var(--header-font-stack); font-weight: var(--header-font-weight); }
  .tck-font-serif { font-family: Georgia, "Times New Roman", serif; }
  .tck-size-small { font-size: .875em; }
  .tck-size-large { font-size: 1.25em; }
  /* the intro is now a div; keep its old look */
  div.tck-survey__intro { opacity: .9; }

  /* Final offer page after submit */
  .tck-survey__final { text-align: center; padding: 60px 20px 40px; max-width: 540px; margin: 0 auto; }
  .tck-survey__final-title { font-size: 30px; margin: 0 0 14px; }
  .tck-survey__final-body { font-size: 16px; opacity: .9; margin-bottom: 22px; }
  .tck-survey__final-offer {
    border: 2px dashed #7cb342; background: rgba(124, 179, 66, .08);
    border-radius: 14px; padding: 14px 18px; margin: 0 0 22px;
  }
  .tck-survey__final-offer-label {
    font-size: 12px; font-weight: 700; letter-spacing: .8px; text-transform: uppercase; opacity: .65; margin: 0 0 4px;
  }
  .tck-survey__final-offer-text { font-size: 18px; font-weight: 700; margin: 0; }
  .tck-survey__final-btn {
    display: block; width: 100%; padding: 18px 24px; border-radius: 999px;
    background: #7cb342; color: #fff; font-size: 19px; font-weight: 700; text-decoration: none;
  }
  .tck-survey__final-btn:hover { opacity: .9; }
```

The intro keeps its existing `max-width: 540px` and centring; long
instructions can be set left-aligned per paragraph from the planner toolbar.

## 3. How to roll out

1. Deploy the planner first (migration 0201 adds the columns; nothing in the
   live theme changes).
2. Apply the two theme edits above on an unpublished theme copy, open a
   survey link with `?s=<token>` and check: intro formatting, lists, links,
   fonts; a survey with the final page OFF ends with the usual thank-you; one
   with it ON shows heading, text, offer (if any) and the button.
3. Publish the theme copy.
