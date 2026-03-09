/*
    ioBroker.vis vis-2-widgets-sigenergy — Widget-Set
    4 Widgets: Energiefluss · Akku-Status · Echtzeit-Leistung · Statistiken

    version: "0.1.5"
    Copyright 2026 ssbingo s.sternitzke@online.de
*/
"use strict";

/* global $, vis, systemDictionary */

// add translations for edit mode
if (typeof systemDictionary !== "undefined") {
    $.extend(
        true,
        systemDictionary,
        {
        "sig_title":    { "en": "Title",             "de": "Titel" },
        "sig_darkmode": { "en": "Dark mode",         "de": "Dunkelmodus" },
        "sig_animation":{ "en": "Animation",         "de": "Animation" },
        "oid_pv":       { "en": "PV Power OID",      "de": "PV-Leistung OID" },
        "oid_bat":      { "en": "Battery Power OID", "de": "Batterie-Leistung OID" },
        "oid_grid":     { "en": "Grid Power OID",    "de": "Netz-Leistung OID" },
        "oid_house":    { "en": "House Power OID",   "de": "Haus-Leistung OID" },
        "oid_soc":      { "en": "Battery SOC OID",   "de": "Batterie SOC OID" },
        "oid_soh":      { "en": "Battery SOH OID",   "de": "Batterie SOH OID" },
        "oid_ttf":      { "en": "Time to Full OID",  "de": "Zeit bis Voll OID" },
        "oid_ttr":      { "en": "Time Remaining OID","de": "Restlaufzeit OID" },
        "oid_sc":       { "en": "Self Consumption OID","de": "Eigenverbrauch OID" },
        "oid_aut":      { "en": "Autarky Rate OID",  "de": "Autarkierate OID" },
        "oid_maxsoc":   { "en": "Day Max SOC OID",   "de": "Tages Max SOC OID" },
        "oid_minsoc":   { "en": "Day Min SOC OID",   "de": "Tages Min SOC OID" },
        "oid_charg":    { "en": "Daily Charge OID",  "de": "Tages-Ladung OID" },
        "oid_discharg": { "en": "Daily Discharge OID","de": "Tages-Entladung OID" },
        "oid_covtime":  { "en": "Battery Coverage OID","de": "Batteriedeckung OID" },
        "oid_chargt":   { "en": "Daily Charge Time OID","de": "Tages-Ladezeit OID" }
        }
    );
}

vis.binds["vis-2-widgets-sigenergy"] = {
    version: "0.1.5",

    showVersion: function () {
        if (vis.binds["vis-2-widgets-sigenergy"].version) {
            console.log("Version vis-2-widgets-sigenergy: " + vis.binds["vis-2-widgets-sigenergy"].version);
            vis.binds["vis-2-widgets-sigenergy"].version = null;
        }
    },

    // ── Helfer ──────────────────────────────────────────────────────────────
    _fmtKW: function (v) {
        var n = parseFloat(v);
        return isNaN(n) ? "-- kW" : (Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2)) + " kW";
    },
    _fmtPct: function (v) {
        var n = parseFloat(v);
        return isNaN(n) ? "--%"    : Math.round(n) + "%";
    },
    _fmtKWh: function (v) {
        var n = parseFloat(v);
        return isNaN(n) ? "-- kWh" : n.toFixed(2) + " kWh";
    },
    _fmtMin: function (v) {
        var m = Math.round(Math.abs(parseFloat(v) || 0));
        if (!m) return "0 min";
        return m < 60 ? m + " min" : Math.floor(m / 60) + "h " + (m % 60) + "m";
    },
    _socCol: function (p) {
        return parseFloat(p) > 60 ? "#27ae60" : parseFloat(p) > 25 ? "#f39c12" : "#e74c3c";
    },
    _el: function (id) { return document.getElementById(id); },
    _txt: function (id, v) {
        var e = vis.binds["vis-2-widgets-sigenergy"]._el(id);
        if (e) e.textContent = v;
    },
    _css: function (id, p, v) {
        var e = vis.binds["vis-2-widgets-sigenergy"]._el(id);
        if (e) e.style[p] = v;
    },

    // State-Zugriff: vis.states[key + '.val']
    _val: function (data, attr) {
        var oid = data.attr(attr);
        if (!oid) return undefined;
        return vis.states[oid + ".val"];
    },

    // Darkmode-Checkbox: VIS-2 liefert Boolean true/false ODER String "true"/"false"
    // Diese Funktion normalisiert beide Varianten zuverlaessig.
    _isDark: function (data) {
        var v = data.attr("sig_darkmode");
        return (v === true || v === "true" || v === "1" || v === 1);
    },

    // Subscription mit VIS-konformem $div.data()-Muster
    _subscribe: function (wid, data, attrs, onChange) {
        var $div  = $("#" + wid);
        var bound = [];
        for (var i = 0; i < attrs.length; i++) {
            var oid = data.attr(attrs[i]);
            if (oid) {
                var key = oid + ".val";
                bound.push(key);
                vis.states.bind(key, onChange);
            }
        }
        $div.data("bound",       bound);
        $div.data("bindHandler", onChange);
    },

    // ── Widget 1: Energiefluss-Diagramm ─────────────────────────────────────
    //
    // SVG-Koordinaten (viewBox 0 0 300 248):
    //   Solar PV   oben-links  (58, 42)
    //   Batterie   oben-rechts (242, 42)
    //   Netz       unten-links (58, 208)
    //   Haus       unten-rechts(242, 208)
    //   Hub ⚡     Mitte       (150, 125)
    //
    // Pfade:
    //   PV   → Hub  M58,63   Q58,125  142,125
    //   Bat  → Hub  M242,63  Q242,125 158,125
    //   Netz → Hub  M58,191  Q58,125  142,125
    //   Hub  → Haus M158,125 Q242,125 242,191
    //
    createEnergyFlow: function (widgetID, view, data, style) {
        var B    = vis.binds["vis-2-widgets-sigenergy"];
        var $div = $("#" + widgetID);
        if (!$div.length) {
            return setTimeout(function () { B.createEnergyFlow(widgetID, view, data, style); }, 100);
        }

        var dark  = B._isDark(data);
        var title = data.attr("sig_title") || "Energiefluss";
        var cls   = dark ? "sig-ef-wrap" : "sig-ef-wrap light";
        var tc    = dark ? "#e0e6ef" : "#2c3e50";  // text colour
        var w     = widgetID;

        // ── Einheitliches SVG: Pfeile + Icons + Labels + Werte ──────────────
        // Alle 5 Knoten liegen im selben Koordinatenraum wie die Pfade,
        // daher zeigen Pfeile immer exakt auf die Icons.

        var svg =
            '<svg viewBox="0 0 300 248" preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' +

            // ── Pfeil-Marker ─────────────────────────────────────────────
            '<defs>' +
            '<marker id="mPv_'   + w + '" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#f39c12"/></marker>' +
            '<marker id="mBat_'  + w + '" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#9b59b6"/></marker>' +
            '<marker id="mGrid_' + w + '" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#3498db"/></marker>' +
            '<marker id="mHouse_'+ w + '" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><polygon points="0,0 6,3 0,6" fill="#27ae60"/></marker>' +
            '</defs>' +

            // ── Animierte Flusspfade ──────────────────────────────────────
            '<path id="sig_path_pv_'   + w + '" class="sig-flow-path pv-color"    d="M58,63  Q58,125  142,125" marker-end="url(#mPv_'   + w + ')"/>' +
            '<path id="sig_path_bat_'  + w + '" class="sig-flow-path bat-color"   d="M242,63 Q242,125 158,125" marker-end="url(#mBat_'  + w + ')"/>' +
            '<path id="sig_path_grid_' + w + '" class="sig-flow-path grid-color"  d="M58,191 Q58,125  142,125" marker-end="url(#mGrid_' + w + ')"/>' +
            '<path id="sig_path_house_'+ w + '" class="sig-flow-path house-color" d="M158,125 Q242,125 242,191" marker-end="url(#mHouse_'+ w + ')"/>' +

            // ── Hub-Kreis Mitte ───────────────────────────────────────────
            '<circle cx="150" cy="125" r="18" fill="' + (dark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)') + '"/>' +
            '<text x="150" y="125" text-anchor="middle" dominant-baseline="central" font-size="18" fill="' + tc + '" opacity="0.85">&#9889;</text>' +

            // ── Solar PV  (oben-links, Knotenmitte 58, 42) ───────────────
            '<text x="58" y="28"  text-anchor="middle" dominant-baseline="central" font-size="20" fill="#f39c12">&#9728;</text>' +
            '<text x="58" y="45"  text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="' + tc + '" opacity="0.65">Solar PV</text>' +
            '<text id="sig_ef_pv_'   + w + '" x="58" y="57" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#f39c12">-- kW</text>' +

            // ── Batterie  (oben-rechts, Knotenmitte 242, 42) ─────────────
            '<text id="sig_ef_baticon_'+ w + '" x="242" y="28" text-anchor="middle" dominant-baseline="central" font-size="20" fill="#9b59b6">&#128267;</text>' +
            '<text x="242" y="45" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="' + tc + '" opacity="0.65">Batterie</text>' +
            '<text id="sig_ef_bat_'  + w + '" x="242" y="57" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#9b59b6">-- kW</text>' +

            // ── Netz  (unten-links, Knotenmitte 58, 208) ─────────────────
            '<text x="58" y="197" text-anchor="middle" dominant-baseline="central" font-size="20" fill="#3498db">&#128268;</text>' +
            '<text x="58" y="214" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="' + tc + '" opacity="0.65">Netz</text>' +
            '<text id="sig_ef_grid_' + w + '" x="58" y="226" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#3498db">-- kW</text>' +

            // ── Haus  (unten-rechts, Knotenmitte 242, 208) ───────────────
            '<text x="242" y="197" text-anchor="middle" dominant-baseline="central" font-size="20" fill="#27ae60">&#127968;</text>' +
            '<text x="242" y="214" text-anchor="middle" dominant-baseline="central" font-size="8.5" fill="' + tc + '" opacity="0.65">Haus</text>' +
            '<text id="sig_ef_house_'+ w + '" x="242" y="226" text-anchor="middle" dominant-baseline="central" font-size="10.5" font-weight="700" fill="#27ae60">-- kW</text>' +

            '</svg>';

        $div.html(
            '<div class="sig-w"><div class="' + cls + '">' +
            '<div class="sig-ef-title">&#9889; ' + title + '</div>' +
            '<div class="sig-ef-svg-wrap">' + svg + '</div>' +
            '</div></div>'
        );

        function update() {
            var pv   = parseFloat(B._val(data, "oid_pv"))    || 0;
            var bat  = parseFloat(B._val(data, "oid_bat"))   || 0;
            var grid = parseFloat(B._val(data, "oid_grid"))  || 0;
            var hous = parseFloat(B._val(data, "oid_house")) || 0;
            var soc  = parseFloat(B._val(data, "oid_soc"))   || 0;

            // Werte setzen (SVG-Text-Knoten)
            B._txt("sig_ef_pv_"    + w, B._fmtKW(pv));
            B._txt("sig_ef_bat_"   + w, B._fmtKW(bat));
            B._txt("sig_ef_grid_"  + w, B._fmtKW(grid));
            B._txt("sig_ef_house_" + w, B._fmtKW(hous));

            // Netz-Farbe: grün = Einspeisung, rot = Bezug
            B._css("sig_ef_grid_"    + w, "fill", grid < 0 ? "#27ae60" : "#e74c3c");
            // Batterie-Icon: Farbe nach SOC
            B._css("sig_ef_baticon_" + w, "fill", B._socCol(soc));

            // Pfade aktivieren/deaktivieren → startet/stoppt CSS-Dash-Animation
            var paths = ["pv", "bat", "grid", "house"];
            var vals  = [pv, bat, grid, hous];
            for (var i = 0; i < paths.length; i++) {
                var el = B._el("sig_path_" + paths[i] + "_" + w);
                if (el) {
                    if (Math.abs(vals[i]) > 0.05) el.classList.add("active");
                    else                           el.classList.remove("active");
                }
            }
        }
        B._subscribe(widgetID, data, ["oid_pv", "oid_bat", "oid_grid", "oid_house", "oid_soc"], update);
        update();
    },

    // ── Widget 2: Akku-Status & Prognosen ───────────────────────────────────
    createBatteryStatus: function (widgetID, view, data, style) {
        var B    = vis.binds["vis-2-widgets-sigenergy"];
        var $div = $("#" + widgetID);
        if (!$div.length) {
            return setTimeout(function () { B.createBatteryStatus(widgetID, view, data, style); }, 100);
        }

        var dark = B._isDark(data);
        var cls  = "sig-bat-wrap" + (dark ? "" : " light");
        var w    = widgetID;

        $div.html(
            '<div class="sig-w"><div class="' + cls + '">' +
            '<div class="sig-bat-head"><span class="icon">&#128267;</span><span class="title">Batterie Status</span>' +
            '<span class="sig-bat-soh" id="sig_bat_soh_' + w + '">SOH: --%</span></div>' +
            '<div class="sig-soc-big" id="sig_bat_soc_' + w + '">--%</div>' +
            '<div class="sig-soc-bar-bg"><div class="sig-soc-bar-fill" id="sig_bat_bar_' + w + '" style="width:0%"></div></div>' +
            '<div class="sig-soc-labels"><span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span></div>' +
            '<div class="sig-bat-stats">' +
            '<div class="sig-stat-box"><div class="sig-stat-label">&#9889; Leistung</div><div class="sig-stat-val" id="sig_bat_pow_' + w + '">--</div></div>' +
            '<div class="sig-stat-box"><div class="sig-stat-label">&#8987; Bis Voll</div><div class="sig-stat-val" id="sig_bat_ttf_' + w + '">--</div></div>' +
            '<div class="sig-stat-box"><div class="sig-stat-label">&#9203; Restlaufzeit</div><div class="sig-stat-val" id="sig_bat_ttr_' + w + '">--</div></div>' +
            '<div class="sig-stat-box"><div class="sig-stat-label">&#9728; Eigenverbrauch</div><div class="sig-stat-val" id="sig_bat_sc_' + w + '">--</div></div>' +
            '<div class="sig-stat-box"><div class="sig-stat-label">&#127969; Autarkierate</div><div class="sig-stat-val" id="sig_bat_aut_' + w + '">--</div></div>' +
            '</div></div></div>'
        );

        function update() {
            var soc = parseFloat(B._val(data, "oid_soc")) || 0;
            var col = B._socCol(soc);
            B._txt("sig_bat_soh_" + w, "SOH: " + B._fmtPct(B._val(data, "oid_soh")));
            B._txt("sig_bat_soc_" + w, B._fmtPct(soc));
            B._css("sig_bat_soc_" + w, "color", col);
            var bar = B._el("sig_bat_bar_" + w);
            if (bar) { bar.style.width = Math.min(100, soc) + "%"; bar.style.background = col; }
            var bat = parseFloat(B._val(data, "oid_bat")) || 0;
            B._txt("sig_bat_pow_" + w, B._fmtKW(bat));
            B._css("sig_bat_pow_" + w, "color", bat >= 0 ? "#27ae60" : "#e74c3c");
            B._txt("sig_bat_ttf_" + w, B._fmtMin(B._val(data, "oid_ttf")));
            B._txt("sig_bat_ttr_" + w, B._fmtMin(B._val(data, "oid_ttr")));
            B._txt("sig_bat_sc_"  + w, B._fmtPct(B._val(data, "oid_sc")));
            B._txt("sig_bat_aut_" + w, B._fmtPct(B._val(data, "oid_aut")));
        }
        B._subscribe(widgetID, data, ["oid_soc", "oid_soh", "oid_bat", "oid_ttf", "oid_ttr", "oid_sc", "oid_aut"], update);
        update();
    },

    // ── Widget 3: Echtzeit-Leistung ─────────────────────────────────────────
    createPowerOverview: function (widgetID, view, data, style) {
        var B    = vis.binds["vis-2-widgets-sigenergy"];
        var $div = $("#" + widgetID);
        if (!$div.length) {
            return setTimeout(function () { B.createPowerOverview(widgetID, view, data, style); }, 100);
        }

        var dark  = B._isDark(data);
        var title = data.attr("sig_title") || "Live Leistung";
        var cls   = "sig-pow-wrap" + (dark ? "" : " light");
        var w     = widgetID;

        $div.html(
            '<div class="sig-w"><div class="' + cls + '">' +
            '<div class="sig-pow-title"><div class="sig-live-dot"></div>' + title + '</div>' +
            '<div class="sig-pow-row"><div class="sig-pow-left"><div class="sig-dot" style="background:#f39c12"></div>&#9728; Solar PV</div><div class="sig-pow-val" id="sig_pow_pv_'    + w + '">-- kW</div></div>' +
            '<div class="sig-pow-row"><div class="sig-pow-left"><div class="sig-dot" style="background:#9b59b6"></div>&#128267; Batterie</div><div class="sig-pow-val" id="sig_pow_bat_'   + w + '">-- kW</div></div>' +
            '<div class="sig-pow-row"><div class="sig-pow-left"><div class="sig-dot" style="background:#3498db"></div>&#128268; Netz</div><div class="sig-pow-val" id="sig_pow_grid_'  + w + '">-- kW</div></div>' +
            '<div class="sig-pow-row"><div class="sig-pow-left"><div class="sig-dot" style="background:#27ae60"></div>&#127968; Haus</div><div class="sig-pow-val" id="sig_pow_house_' + w + '">-- kW</div></div>' +
            '<div class="sig-pow-row" style="border-top:1px solid rgba(128,128,128,.15);margin-top:6px;padding-top:6px;">' +
            '<div class="sig-pow-left"><div class="sig-dot" style="background:#8e44ad"></div>&#128267; SOC</div>' +
            '<div class="sig-pow-val" id="sig_pow_soc_' + w + '">--%</div></div>' +
            '</div></div>'
        );

        function update() {
            var bat  = parseFloat(B._val(data, "oid_bat"))  || 0;
            var grid = parseFloat(B._val(data, "oid_grid")) || 0;
            var soc  = B._val(data, "oid_soc");
            B._txt("sig_pow_pv_"    + w, B._fmtKW(B._val(data, "oid_pv")));
            B._txt("sig_pow_bat_"   + w, B._fmtKW(bat));
            B._css("sig_pow_bat_"   + w, "color", bat  < 0 ? "#e74c3c" : "#27ae60");
            B._txt("sig_pow_grid_"  + w, B._fmtKW(grid));
            B._css("sig_pow_grid_"  + w, "color", grid < 0 ? "#27ae60" : "#e74c3c");
            B._txt("sig_pow_house_" + w, B._fmtKW(B._val(data, "oid_house")));
            B._txt("sig_pow_soc_"   + w, B._fmtPct(soc));
            B._css("sig_pow_soc_"   + w, "color", B._socCol(soc));
        }
        B._subscribe(widgetID, data, ["oid_pv", "oid_bat", "oid_grid", "oid_house", "oid_soc"], update);
        update();
    },

    // ── Widget 4: Energiestatistiken ────────────────────────────────────────
    createStatistics: function (widgetID, view, data, style) {
        var B    = vis.binds["vis-2-widgets-sigenergy"];
        var $div = $("#" + widgetID);
        if (!$div.length) {
            return setTimeout(function () { B.createStatistics(widgetID, view, data, style); }, 100);
        }

        var dark  = B._isDark(data);
        var title = data.attr("sig_title") || "Tagesstatistik";
        var cls   = "sig-stats-wrap" + (dark ? " dark" : "");
        var w     = widgetID;

        $div.html(
            '<div class="sig-w"><div class="' + cls + '">' +
            '<div class="sig-stats-title">&#128202; ' + title + '</div>' +
            '<div class="sig-stats-grid">' +
            '<div class="sig-stats-item"><div class="s-label">&#127969; Autarkierate</div><div class="s-value" style="color:#27ae60" id="sig_st_aut_'    + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#8635; Eigenverbrauch</div><div class="s-value" style="color:#9b59b6" id="sig_st_sc_'     + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#8593; Max SOC heute</div><div class="s-value" style="color:#f39c12" id="sig_st_maxsoc_'  + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#8595; Min SOC heute</div><div class="s-value" style="color:#3498db" id="sig_st_minsoc_'  + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#11014; Tages-Ladung</div><div class="s-value" style="color:#16a085" id="sig_st_chg_'    + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#11015; Tages-Entladung</div><div class="s-value" style="color:#e74c3c" id="sig_st_dchg_' + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#8987; Batteriedeckung</div><div class="s-value" style="color:#8e44ad" id="sig_st_cov_'   + w + '">--</div></div>' +
            '<div class="sig-stats-item"><div class="s-label">&#9889; Ladezeit heute</div><div class="s-value" style="color:#c0392b" id="sig_st_cht_'    + w + '">--</div></div>' +
            '</div></div></div>'
        );

        function update() {
            B._txt("sig_st_aut_"    + w, B._fmtPct(B._val(data, "oid_aut")));
            B._txt("sig_st_sc_"     + w, B._fmtPct(B._val(data, "oid_sc")));
            B._txt("sig_st_maxsoc_" + w, B._fmtPct(B._val(data, "oid_maxsoc")));
            B._txt("sig_st_minsoc_" + w, B._fmtPct(B._val(data, "oid_minsoc")));
            B._txt("sig_st_chg_"    + w, B._fmtKWh(B._val(data, "oid_charg")));
            B._txt("sig_st_dchg_"   + w, B._fmtKWh(B._val(data, "oid_discharg")));
            B._txt("sig_st_cov_"    + w, B._fmtMin(B._val(data, "oid_covtime")));
            B._txt("sig_st_cht_"    + w, B._fmtMin(B._val(data, "oid_chargt")));
        }
        B._subscribe(widgetID, data, ["oid_aut", "oid_sc", "oid_maxsoc", "oid_minsoc", "oid_charg", "oid_discharg", "oid_covtime", "oid_chargt"], update);
        update();
    }
};

vis.binds["vis-2-widgets-sigenergy"].showVersion();
