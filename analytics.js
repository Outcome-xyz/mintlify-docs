/**
 * PostHog analytics for the Outcome docs.
 *
 * Mintlify injects every .js file in the content root into every page, after the
 * page is interactive. It gives no ordering guarantee, no way to scope a script
 * to certain pages, and no documented guarantee about whether this file re-runs
 * on client-side navigation — so everything here is written to survive both
 * running once and running repeatedly, and to survive the DOM being swapped out
 * underneath it.
 *
 * IMPORTANT: do not add `integrations.posthog` to docs.json. This file owns the
 * PostHog instance; Mintlify's built-in integration would load a second one and
 * double-count every pageview.
 *
 * Two rules keep this working against a SPA whose internals we don't control:
 *   1. Never bind to an element. Bind to `document` in the capture phase and
 *      resolve the target on the way up — delegated listeners outlive re-renders.
 *   2. Never depend on a Mintlify class name. Match on structure and semantics
 *      (a <pre> ancestor, an aria-label, an href origin), so a redesign
 *      degrades one property rather than silencing an event.
 */
(function () {
  "use strict";

  var PROJECT_TOKEN = "phc_oeaiETfkRbR7way4VoQWkaLvQT3m8orF48gwLcFjmNN7";
  var API_HOST = "https://us.i.posthog.com";

  var APP_ORIGINS = ["outcome.xyz"];
  var SCROLL_MILESTONES = [25, 50, 75, 90, 100];
  var IDLE_AFTER_MS = 30000;
  var SEARCH_DEBOUNCE_MS = 900;

  if (window.__outcomeDocsAnalytics) return;
  window.__outcomeDocsAnalytics = true;

  // ---------------------------------------------------------------------------
  // Loader — the official posthog-js stub. Queues calls made before array.js
  // lands, so nothing below has to wait for the network.
  // ---------------------------------------------------------------------------

  !function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.crossOrigin="anonymous",p.async=!0,p.src=s.api_host.replace(".i.posthog.com","-assets.i.posthog.com")+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="init capture register register_once register_for_session unregister unregister_for_session getFeatureFlag getFeatureFlagResult isFeatureEnabled reloadFeatureFlags updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures on onFeatureFlags onSessionId getSurveys getActiveMatchingSurveys renderSurvey canRenderSurvey getNextSurveyStep identify setPersonProperties group resetGroups setPersonPropertiesForFlags resetPersonPropertiesForFlags setGroupPropertiesForFlags resetGroupPropertiesForFlags reset get_distinct_id getGroups get_session_id get_session_replay_url alias set_config startSessionRecording stopSessionRecording sessionRecordingStarted captureException loadToolbar get_property getSessionProperty createPersonProfile opt_in_capturing opt_out_capturing has_opted_in_capturing has_opted_out_capturing clear_opt_in_out_capturing debug".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);

  posthog.init(PROJECT_TOKEN, {
    api_host: API_HOST,
    defaults: "2026-05-30",

    // 'history_change' is what makes pageviews correct in a SPA — Mintlify
    // routes client-side, so a load-event pageview would only ever fire once.
    capture_pageview: "history_change",
    capture_pageleave: true,

    autocapture: { capture_copied_text: true },
    rageclick: true,
    capture_dead_clicks: true,
    enable_heatmaps: true,
    capture_performance: { web_vitals: true, network_timing: true },
    capture_exceptions: true,

    // Docs are public and anonymous: a profile per visitor is what makes
    // "returning reader" and retention answerable at all.
    person_profiles: "always",
    persistence: "localStorage+cookie",

    session_recording: {
      // Nothing on this site is a credential or PII — the only inputs are the
      // search box, whose contents are the single most useful thing to see.
      // Add .ph-mask to any element that ever stops being true.
      maskAllInputs: false,
      maskTextSelector: ".ph-mask",
      recordCrossOriginIframes: true,
    },

    loaded: function (ph) {
      ph.register(deviceContext());
      registerPage();
      startPage(ph);
    },
  });

  // ---------------------------------------------------------------------------
  // Context — registered as super properties so every event, autocaptured ones
  // included, is sliceable by tab/group/device without touching a call site.
  // ---------------------------------------------------------------------------

  function deviceContext() {
    var ua = navigator.userAgent || "";
    var w = window.innerWidth || 0;
    var conn = navigator.connection || {};

    return {
      docs_device_class: w < 640 ? "mobile" : w < 1024 ? "tablet" : "desktop",
      docs_viewport_w: w,
      docs_viewport_h: window.innerHeight || 0,
      docs_viewport_bucket: w < 640 ? "<640" : w < 1024 ? "640-1023" : w < 1440 ? "1024-1439" : "1440+",
      docs_orientation: w > (window.innerHeight || 0) ? "landscape" : "portrait",
      docs_pixel_ratio: window.devicePixelRatio || 1,
      docs_touch: "ontouchstart" in window || (navigator.maxTouchPoints || 0) > 0,
      docs_pwa: !!(window.matchMedia && matchMedia("(display-mode: standalone)").matches),
      docs_language: navigator.language || null,
      docs_timezone: tz(),
      docs_connection: conn.effectiveType || null,
      docs_save_data: !!conn.saveData,
      docs_reduced_motion: !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches),
      docs_prefers_dark: !!(window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches),
      docs_bot_ua: /bot|crawl|spider|headless|lighthouse/i.test(ua),
    };
  }

  function tz() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch (e) {
      return null;
    }
  }

  // Tab comes from the path because that mirrors docs.json's routing and can't
  // drift. Group comes from the rendered breadcrumb — a hardcoded slug->group
  // map would silently mislabel data the first time someone reorders the nav.
  function pageContext() {
    var path = location.pathname.replace(/\/+$/, "") || "/";
    var slug = path.replace(/^\//, "") || "introduction";

    var tab = "Documentation";
    if (/^sdk\/guides\//.test(slug)) tab = "Guides";
    else if (/^sdk\//.test(slug)) tab = "SDK Reference";

    return {
      docs_tab: tab,
      docs_group: breadcrumbGroup(),
      docs_slug: slug,
      docs_path: path,
      docs_page_title: document.title || null,
      docs_theme: currentTheme(),
    };
  }

  // docs.json sets styling.eyebrows = "breadcrumbs", which Mintlify renders as
  // .breadcrumb-list holding the page's nav group ("Get Started", "Concepts").
  // Reading it beats a hardcoded slug->group map, which would silently mislabel
  // every event the first time someone reorders the nav.
  function breadcrumbGroup() {
    var el = document.querySelector(".breadcrumb-list");
    var text = el && el.textContent ? el.textContent.replace(/\s+/g, " ").trim() : "";
    if (!text) return null;
    var parts = text.split(/[›/>|]/).map(trim).filter(Boolean);
    return (parts.length ? parts[parts.length - 1] : text).slice(0, 80);
  }

  // Mintlify follows Tailwind's convention: a `dark` class on <html>, and
  // nothing at all for light. Absence is the signal, not a "light" class.
  function currentTheme() {
    var root = document.documentElement;
    if (root.classList.contains("dark")) return "dark";
    return root.getAttribute("data-theme") || "light";
  }

  function registerPage() {
    posthog.register(pageContext());
  }

  // ---------------------------------------------------------------------------
  // Per-page state — scroll depth and engaged time reset on every route change.
  // ---------------------------------------------------------------------------

  var page = null;

  function startPage(ph) {
    page = {
      startedAt: now(),
      engagedMs: 0,
      lastActiveAt: now(),
      active: true,
      maxScroll: 0,
      firedMilestones: {},
      copies: 0,
      searches: 0,
    };
    if (ph) ph.capture("docs_page_entered", pageContext());
  }

  function endPage(reason) {
    if (!page) return;
    settleEngagement();

    posthog.capture("docs_page_exited", extend(pageContext(), {
      docs_exit_reason: reason,
      docs_time_on_page_ms: now() - page.startedAt,
      docs_engaged_ms: Math.round(page.engagedMs),
      docs_engaged_ratio: round2(page.engagedMs / Math.max(1, now() - page.startedAt)),
      docs_max_scroll_pct: page.maxScroll,
      docs_read_to_end: page.maxScroll >= 90,
      docs_code_copies: page.copies,
      docs_searches: page.searches,
    }));
    page = null;
  }

  // Engaged time counts only while the reader is actually here: idle after 30s
  // of no input, and paused entirely while the tab is hidden. Without this,
  // "time on page" is just "tab left open in a background window".
  function settleEngagement() {
    if (!page || !page.active) return;
    var t = now();
    var since = t - page.lastActiveAt;
    if (since < IDLE_AFTER_MS) page.engagedMs += since;
    else page.engagedMs += IDLE_AFTER_MS;
    page.lastActiveAt = t;
  }

  function markActive() {
    if (!page) return;
    var t = now();
    if (t - page.lastActiveAt < IDLE_AFTER_MS) page.engagedMs += t - page.lastActiveAt;
    page.lastActiveAt = t;
    page.active = true;
  }

  ["mousemove", "keydown", "scroll", "click", "touchstart", "wheel"].forEach(function (evt) {
    document.addEventListener(evt, throttle(markActive, 1000), { capture: true, passive: true });
  });

  // ---------------------------------------------------------------------------
  // Route changes — patch the history API, since a SPA nav fires no pageview.
  // ---------------------------------------------------------------------------

  var lastPath = location.pathname;

  function onRouteChange() {
    if (location.pathname === lastPath) return;
    endPage("navigation");
    lastPath = location.pathname;
    // The new page's title/breadcrumb aren't painted on the same tick.
    setTimeout(function () {
      registerPage();
      startPage(posthog);
      if (location.hash) captureAnchorLanding();
    }, 60);
  }

  ["pushState", "replaceState"].forEach(function (m) {
    var orig = history[m];
    history[m] = function () {
      var r = orig.apply(this, arguments);
      onRouteChange();
      return r;
    };
  });
  window.addEventListener("popstate", onRouteChange);
  window.addEventListener("hashchange", captureAnchorLanding);

  function captureAnchorLanding() {
    if (!location.hash) return;
    posthog.capture("docs_anchor_landed", extend(pageContext(), {
      docs_anchor: location.hash.slice(0, 120),
    }));
  }

  // ---------------------------------------------------------------------------
  // Clicks — one delegated capture-phase listener, classified on the way up.
  // Autocapture still records the raw click; these add the docs-specific
  // meaning autocapture can't infer.
  // ---------------------------------------------------------------------------

  document.addEventListener("click", function (e) {
    var el = e.target instanceof Element ? e.target : null;
    if (!el) return;

    var code = codeBlockCopyTarget(el);
    if (code) {
      if (page) page.copies++;
      return posthog.capture("docs_code_copied", extend(pageContext(), {
        docs_code_language: code.lang,
        docs_code_lines: code.lines,
        docs_code_chars: code.chars,
        docs_code_preview: code.preview,
      }));
    }

    var contextual = contextualAction(el);
    if (contextual) {
      return posthog.capture("docs_contextual_action", extend(pageContext(), {
        docs_action: contextual,
      }));
    }

    // Links inside the search dialog are owned by the search handler below —
    // classifying them here too would count every result click twice.
    var link = el.closest("a[href]");
    if (link && !link.closest('[role="dialog"]')) return classifyLink(link);

    var disclosure = el.closest('[role="tab"], summary, [aria-expanded]');
    if (disclosure) {
      var expanded = disclosure.getAttribute("aria-expanded");
      return posthog.capture(
        disclosure.getAttribute("role") === "tab" ? "docs_tab_switched" : "docs_disclosure_toggled",
        extend(pageContext(), {
          docs_label: text(disclosure, 80),
          // Read before the component flips it, so this is the pre-click state.
          docs_now_open: expanded === null ? null : expanded !== "true",
        })
      );
    }

    if (el.closest("img, [class*='zoom'], [class*='lightbox']")) {
      var img = el.closest("img") || el.querySelector("img");
      return posthog.capture("docs_image_opened", extend(pageContext(), {
        docs_image_src: img ? img.getAttribute("src") : null,
        docs_image_alt: img ? img.getAttribute("alt") : null,
      }));
    }

    if (isSearchTrigger(el)) {
      return posthog.capture("docs_search_opened", pageContext());
    }
  }, { capture: true, passive: true });

  // The theme control is a menu trigger, so the click itself changes nothing —
  // the class flips a beat later when an option is chosen. Watching <html> gets
  // the real transition, and catches OS-level switches the button never sees.
  var lastTheme = currentTheme();
  new MutationObserver(function () {
    var t = currentTheme();
    if (t === lastTheme) return;
    lastTheme = t;
    posthog.register({ docs_theme: t });
    posthog.capture("docs_theme_changed", extend(pageContext(), { docs_theme_now: t }));
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme"] });

  function classifyLink(a) {
    var href = a.getAttribute("href") || "";
    var url = absolute(href);
    var props = extend(pageContext(), {
      docs_link_href: url,
      docs_link_text: text(a, 120),
    });

    if (href.charAt(0) === "#") {
      props.docs_anchor = href.slice(0, 120);
      return posthog.capture("docs_toc_clicked", props);
    }

    if (url && !sameOrigin(url)) {
      var host = hostOf(url);
      props.docs_link_host = host;
      if (APP_ORIGINS.some(function (o) { return host === o || endsWith(host, "." + o); })) {
        // The docs -> app handoff. This is the conversion the funnel hangs on.
        props.docs_cta_location = ctaLocation(a);
        return posthog.capture("docs_app_cta_clicked", props);
      }
      return posthog.capture("docs_external_link_clicked", props);
    }

    props.docs_nav_region = navRegion(a);
    return posthog.capture("docs_internal_link_clicked", props);
  }

  // Region selectors below are the ones Mintlify actually renders: nav#sidebar
  // ("Pages"), nav[aria-label="Main"] (navbar), #table-of-contents-content.
  function ctaLocation(a) {
    if (a.closest("[class*='banner']")) return "banner";
    if (a.closest('nav[aria-label="Main"], header, [class*="navbar"]')) return "navbar";
    if (a.closest("#sidebar, aside")) return "sidebar";
    if (a.closest("footer")) return "footer";
    return "content";
  }

  function navRegion(a) {
    if (a.closest("#table-of-contents-content, [class*='toc'], [class*='on-this-page']")) return "toc";
    if (a.closest("#sidebar, aside, [class*='sidebar']")) return "sidebar";
    if (a.closest('nav[aria-label="Main"], header, [class*="navbar"]')) return "navbar";
    if (a.closest("footer")) return "footer";
    if (a.closest("[class*='card']")) return "card";
    return "content";
  }

  // Mintlify renders code blocks as `div.code-block[language]` with a copy
  // button carrying data-testid="copy-code-button". Both are checked here, but
  // the structural fallback (a button inside a container holding a <pre>) keeps
  // this working if either hook is renamed.
  function codeBlockCopyTarget(el) {
    var btn = el.closest('button, [role="button"]');
    if (!btn) return null;

    var block = btn.closest(".code-block");
    if (!block) {
      var label = ((btn.getAttribute("aria-label") || "") + " " + (btn.getAttribute("title") || "")).toLowerCase();
      if (label.indexOf("copy") === -1) return null;
      var container = btn.closest("div, figure, section");
      for (var i = 0; i < 5 && container && !block; i++) {
        if (container.querySelector("pre")) block = container;
        else container = container.parentElement;
      }
      if (!block) return null;
    }

    var isCopy =
      btn.getAttribute("data-testid") === "copy-code-button" ||
      ((btn.getAttribute("aria-label") || "").toLowerCase().indexOf("copy") !== -1);
    if (!isCopy) return null;

    var pre = block.querySelector("pre");
    var body = pre ? pre.textContent || "" : "";
    return {
      lang: languageOf(block),
      lines: parseInt(block.getAttribute("numberoflines"), 10) || body.split("\n").length,
      chars: body.length,
      preview: body.trim().slice(0, 120),
    };
  }

  // Shiki strips the language off <pre> (it only carries theme classes), so the
  // only place it survives is the wrapper's `language` attribute.
  function languageOf(block) {
    return (
      block.getAttribute("language") ||
      block.getAttribute("data-language") ||
      null
    );
  }

  // docs.json enables contextual: copy / chatgpt / claude / cursor / vscode / mcp.
  // These are how people pull docs into an agent — worth knowing which win.
  function contextualAction(el) {
    var hit = el.closest("button, a, [role='menuitem'], [role='option']");
    if (!hit) return null;
    var label = (text(hit, 60) + " " + (hit.getAttribute("aria-label") || "")).toLowerCase();
    if (!label) return null;

    if (/copy page|copy markdown|copy for/.test(label)) return "copy_page";
    if (/chatgpt/.test(label)) return "chatgpt";
    if (/claude/.test(label)) return "claude";
    if (/cursor/.test(label)) return "cursor";
    if (/vs ?code/.test(label)) return "vscode";
    if (/\bmcp\b/.test(label)) return "mcp";
    return null;
  }

  function isSearchTrigger(el) {
    var t = el.closest('[id*="search" i], [class*="search" i], [aria-label*="search" i], [data-testid*="search" i]');
    return !!t && !t.closest('[role="dialog"]');
  }

  // ---------------------------------------------------------------------------
  // Search — the highest-signal event on any docs site: it's a literal list of
  // what people expected to find. Debounced so we log intent, not keystrokes.
  // ---------------------------------------------------------------------------

  var searchTimer = null;
  var lastQuery = "";

  document.addEventListener("input", function (e) {
    var el = e.target;
    if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) return;
    if (!looksLikeSearch(el)) return;

    var q = el.value || "";
    clearTimeout(searchTimer);
    searchTimer = setTimeout(function () {
      var query = q.trim();
      if (!query || query === lastQuery) return;
      lastQuery = query;
      if (page) page.searches++;
      posthog.capture("docs_search_query", extend(pageContext(), {
        docs_query: query.slice(0, 200),
        docs_query_length: query.length,
        docs_result_count: visibleResultCount(),
      }));
    }, SEARCH_DEBOUNCE_MS);
  }, { capture: true, passive: true });

  function looksLikeSearch(el) {
    if (el.type === "search") return true;
    var hint = ((el.getAttribute("placeholder") || "") + " " + (el.getAttribute("aria-label") || "") + " " + (el.id || "") + " " + (el.name || "")).toLowerCase();
    if (/search|ask|find/.test(hint)) return true;
    return !!el.closest('[role="dialog"], [class*="search" i]');
  }

  function visibleResultCount() {
    var dialog = document.querySelector('[role="dialog"]');
    if (!dialog) return null;
    var results = dialog.querySelectorAll('[role="option"], li a, [class*="result" i] a');
    return results.length || null;
  }

  // A search followed by a result click is a success; a search followed by
  // nothing is a content gap. Both need the query attached to be worth anything.
  document.addEventListener("click", function (e) {
    var el = e.target instanceof Element ? e.target : null;
    if (!el) return;
    var dialog = el.closest('[role="dialog"]');
    if (!dialog) return;
    var link = el.closest("a[href], [role='option']");
    if (!link) return;

    posthog.capture("docs_search_result_clicked", extend(pageContext(), {
      docs_query: lastQuery.slice(0, 200),
      docs_result_href: absolute(link.getAttribute("href") || ""),
      docs_result_text: text(link, 120),
      docs_result_position: positionAmong(link, dialog),
    }));
  }, { capture: true, passive: true });

  function positionAmong(link, dialog) {
    var all = Array.prototype.slice.call(dialog.querySelectorAll("a[href], [role='option']"));
    var i = all.indexOf(link);
    return i === -1 ? null : i + 1;
  }

  // ---------------------------------------------------------------------------
  // Scroll depth — milestones rather than a stream, so it's a funnel you can
  // read: how far into each page people actually get.
  // ---------------------------------------------------------------------------

  window.addEventListener("scroll", throttle(function () {
    if (!page) return;
    var pct = scrollPct();
    if (pct <= page.maxScroll) return;
    page.maxScroll = pct;

    SCROLL_MILESTONES.forEach(function (m) {
      if (pct >= m && !page.firedMilestones[m]) {
        page.firedMilestones[m] = true;
        posthog.capture("docs_scroll_depth", extend(pageContext(), {
          docs_depth_pct: m,
          docs_ms_to_depth: now() - page.startedAt,
        }));
      }
    });
  }, 400), { passive: true });

  function scrollPct() {
    var doc = document.documentElement;
    var scrollable = doc.scrollHeight - window.innerHeight;
    if (scrollable <= 0) return 100;
    var pct = ((window.scrollY || doc.scrollTop || 0) / scrollable) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }

  // ---------------------------------------------------------------------------
  // Selection, exit intent, errors
  // ---------------------------------------------------------------------------

  document.addEventListener("copy", function () {
    var sel = String(window.getSelection ? window.getSelection() : "").trim();
    if (!sel) return;
    posthog.capture("docs_text_copied", extend(pageContext(), {
      docs_copied_chars: sel.length,
      docs_copied_preview: sel.slice(0, 200),
    }));
  }, { capture: true, passive: true });

  var exitFired = false;
  document.addEventListener("mouseleave", function (e) {
    if (exitFired || !page) return;
    if (e.clientY > 8) return;
    exitFired = true;
    posthog.capture("docs_exit_intent", extend(pageContext(), {
      docs_max_scroll_pct: page.maxScroll,
      docs_time_on_page_ms: now() - page.startedAt,
    }));
  });

  window.addEventListener("error", function (e) {
    posthog.capture("docs_js_error", extend(pageContext(), {
      docs_error_message: String(e.message || "").slice(0, 300),
      docs_error_source: e.filename || null,
    }));
  });

  // The docs render images and lockups from /images — a 404 here is invisible
  // in page analytics but very visible to the reader.
  document.addEventListener("error", function (e) {
    var el = e.target;
    if (!(el instanceof HTMLImageElement)) return;
    posthog.capture("docs_asset_failed", extend(pageContext(), {
      docs_asset_src: el.getAttribute("src"),
    }));
  }, { capture: true });

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  document.addEventListener("visibilitychange", function () {
    if (!page) return;
    if (document.visibilityState === "hidden") {
      settleEngagement();
      page.active = false;
    } else {
      page.lastActiveAt = now();
      page.active = true;
    }
  });

  window.addEventListener("resize", throttle(function () {
    posthog.register(deviceContext());
  }, 1000), { passive: true });

  // pagehide beats unload: it's the only one that reliably fires on iOS Safari,
  // which is where a real slice of mobile docs traffic ends.
  window.addEventListener("pagehide", function () {
    endPage("pagehide");
  });

  // ---------------------------------------------------------------------------
  // Utils
  // ---------------------------------------------------------------------------

  function now() {
    return Date.now();
  }

  function extend(a, b) {
    var out = {};
    for (var k in a) if (Object.prototype.hasOwnProperty.call(a, k)) out[k] = a[k];
    for (var j in b) if (Object.prototype.hasOwnProperty.call(b, j)) out[j] = b[j];
    return out;
  }

  function text(el, max) {
    var t = (el.textContent || "").replace(/\s+/g, " ").trim();
    return t.slice(0, max || 100);
  }

  function trim(s) {
    return s.trim();
  }

  function absolute(href) {
    try {
      return new URL(href, location.href).href;
    } catch (e) {
      return href || null;
    }
  }

  function hostOf(url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch (e) {
      return null;
    }
  }

  function sameOrigin(url) {
    try {
      return new URL(url).origin === location.origin;
    } catch (e) {
      return true;
    }
  }

  function endsWith(s, suffix) {
    return !!s && s.indexOf(suffix, s.length - suffix.length) !== -1;
  }

  function round2(n) {
    return Math.round(n * 100) / 100;
  }

  function throttle(fn, ms) {
    var last = 0;
    var timer = null;
    return function () {
      var t = now();
      var wait = ms - (t - last);
      if (wait <= 0) {
        last = t;
        fn();
      } else if (!timer) {
        timer = setTimeout(function () {
          timer = null;
          last = now();
          fn();
        }, wait);
      }
    };
  }
})();
