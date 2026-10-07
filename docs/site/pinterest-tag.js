
(function () {
  var TAG_ID = "2612972022570";
  var BRAND = "AESTH.";
  var CATEGORY = "Apparel & Accessories > Clothing > Shirts & Tops";
  var geladen = false;
  var gezien = {};
  var match = {}; // Enhanced Match: external_id (+ em zodra bekend), beide SHA-256

  function targetingToegestaan() {
    try {
      var m = document.cookie.match(/(?:^|;\s*)cc_cookie=([^;]*)/);
      if (!m) return false;
      var v = JSON.parse(decodeURIComponent(m[1]));
      var cats = v.categories || v.level || [];
      return cats.indexOf("targeting") !== -1;
    } catch (e) { return false; }
  }

  function sha256(tekst) {
    if (!window.crypto || !crypto.subtle || !window.TextEncoder) return Promise.resolve(null);
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(tekst)).then(function (buf) {
      var b = new Uint8Array(buf), s = "";
      for (var i = 0; i < b.length; i++) s += ("0" + b[i].toString(16)).slice(-2);
      return s;
    }).catch(function () { return null; });
  }

  function anoniemId() {
    try {
      var k = "aesth_pid", v = localStorage.getItem(k);
      if (!v) {
        v = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
        localStorage.setItem(k, v);
      }
      return v;
    } catch (e) { return null; }
  }

  function slugUitUrl() {
    var m = location.pathname.match(/\/products\/([^/?#]+)/);
    return m ? m[1] : null;
  }

  function productId(item) {
    // Catalogus-id = <slug>-pepper (één kleur). Op de productpagina kennen we de slug;
    // elders valt het terug op het Fourthwall-id van het item.
    var slug = slugUitUrl();
    if (slug) return slug + "-pepper";
    return item && (item.item_id || item.id) ? String(item.item_id || item.id) : undefined;
  }

  function lineItems(items) {
    var out = [];
    for (var i = 0; i < (items || []).length; i++) {
      var it = items[i] || {};
      out.push({
        product_id: productId(it),
        product_name: it.item_name || it.name,
        product_price: it.price != null ? Number(it.price) : undefined,
        product_quantity: Number(it.quantity || 1),
        product_brand: BRAND,
        product_category: CATEGORY,
        product_variant: it.item_variant || undefined
      });
    }
    return out;
  }

  function basis(ec) {
    ec = ec || {};
    var d = { currency: ec.currency || "USD" };
    if (ec.value != null && !isNaN(Number(ec.value))) d.value = Number(ec.value);
    if (ec.items && ec.items.length) {
      d.line_items = lineItems(ec.items);
      var q = 0;
      for (var i = 0; i < ec.items.length; i++) q += Number(ec.items[i].quantity || 1);
      d.order_quantity = q;
      if (d.line_items.length === 1 && d.line_items[0].product_id) d.product_id = d.line_items[0].product_id;
    }
    return d;
  }

  function stuur(naam, data) {
    if (window.pintrk) window.pintrk("track", naam, data);
  }

  function verwerk(e) {
    if (!e || !e.event || !window.pintrk) return;
    var sleutel = e.event + ":" + (e.eventId || e["gtm.uniqueEventId"] || "");
    if (gezien[sleutel]) return;
    gezien[sleutel] = true;
    var ec = e.ecommerce || {};
    if (e.event === "view_item") {
      stuur("pagevisit", basis(ec));
    } else if (e.event === "add_to_cart") {
      stuur("addtocart", basis(ec));
    } else if (e.event === "purchase") {
      var d = basis(ec);
      d.order_id = ec.transaction_id || e.transaction_id || e.orderId || undefined;
      var email = (e.customer && e.customer.email) || e.email || (ec.customer && ec.customer.email);
      if (email) {
        sha256(String(email).trim().toLowerCase()).then(function (h) {
          if (h && !match.em) { match.em = h; window.pintrk("load", TAG_ID, match); }
          stuur("checkout", d);
        });
      } else {
        stuur("checkout", d);
      }
    }
  }


  // Fourthwall zet add_to_cart niet in de dataLayer (server-side analytics); de knop doet
  // een XHR naar /cart/add.js. Daarop haken we in en sturen addtocart met de productgegevens
  // van de pagina (view_item).
  function laatsteViewItem() {
    var dl = window.dataLayer || [], ec = null;
    for (var i = 0; i < dl.length; i++) if (dl[i] && dl[i].event === "view_item" && dl[i].ecommerce) ec = dl[i].ecommerce;
    return ec;
  }
  function koppelWinkelwagen() {
    var open = XMLHttpRequest.prototype.open, send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, url) { this.__aesthUrl = String(url || ""); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (body) {
      var xhr = this;
      if (/\/cart\/add\.js/.test(xhr.__aesthUrl || "")) {
        var aantal = 1;
        try {
          if (typeof body === "string") { var q = body.match(/quantity=(\d+)/); if (q) aantal = Number(q[1]); }
          else if (body && body.get) { aantal = Number(body.get("quantity") || 1); }
        } catch (e) {}
        xhr.addEventListener("load", function () {
          if (xhr.status < 200 || xhr.status >= 300) return;
          var ec = laatsteViewItem() || {};
          var items = (ec.items || []).map(function (it) { var c = {}; for (var k in it) c[k] = it[k]; c.quantity = aantal; return c; });
          var d = basis({ currency: ec.currency, value: ec.value != null ? Number(ec.value) * aantal : undefined, items: items });
          if (!d.product_id && slugUitUrl()) d.product_id = slugUitUrl() + "-pepper";
          stuur("addtocart", d);
        });
      }
      return send.apply(this, arguments);
    };
    var f = window.fetch;
    if (f) window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : (input && input.url) || "";
      var p = f.apply(this, arguments);
      if (/\/cart\/add\.js/.test(url)) p.then(function (res) {
        if (!res.ok) return;
        var ec = laatsteViewItem() || {};
        var d = basis(ec);
        if (!d.product_id && slugUitUrl()) d.product_id = slugUitUrl() + "-pepper";
        stuur("addtocart", d);
      }).catch(function () {});
      return p;
    };
  }

  function koppelDataLayer() {
    var dl = (window.dataLayer = window.dataLayer || []);
    for (var i = 0; i < dl.length; i++) verwerk(dl[i]);
    var origineel = dl.push;
    dl.push = function () {
      var r = origineel.apply(dl, arguments);
      for (var i = 0; i < arguments.length; i++) verwerk(arguments[i]);
      return r;
    };
  }

  function laadTag() {
    if (geladen) return;
    geladen = true;
    !function (e) {
      if (!window.pintrk) {
        window.pintrk = function () { window.pintrk.queue.push(Array.prototype.slice.call(arguments)); };
        var n = window.pintrk; n.queue = []; n.version = "3.0";
        var t = document.createElement("script"); t.async = !0; t.src = e;
        var r = document.getElementsByTagName("script")[0]; r.parentNode.insertBefore(t, r);
      }
    }("https://s.pinimg.com/ct/core.js");

    var pid = anoniemId();
    var klaar = pid ? sha256(pid) : Promise.resolve(null);
    klaar.then(function (h) {
      if (h) match.external_id = h;
      // Bedankpagina: e-mail uit het purchase-event meteen meegeven bij het laden.
      var dl = window.dataLayer || [], email = null;
      for (var i = 0; i < dl.length; i++) {
        var e = dl[i];
        if (e && e.event === "purchase") email = (e.customer && e.customer.email) || e.email || (e.ecommerce && e.ecommerce.customer && e.ecommerce.customer.email) || email;
      }
      return email ? sha256(String(email).trim().toLowerCase()) : null;
    }).then(function (hem) {
      if (hem) match.em = hem;
      window.pintrk("load", TAG_ID, match);
      window.pintrk("page");
      // Productpagina zonder dataLayer-event: alsnog een pagevisit met product_id.
      var slug = slugUitUrl();
      if (slug) {
        var heeftViewItem = (window.dataLayer || []).some(function (e) { return e && e.event === "view_item"; });
        if (!heeftViewItem) stuur("pagevisit", { product_id: slug + "-pepper", line_items: [{ product_id: slug + "-pepper", product_brand: BRAND, product_category: CATEGORY }] });
      }
      koppelDataLayer();
      koppelWinkelwagen();
    });
  }

  if (targetingToegestaan()) {
    laadTag();
  } else {
    var timer = setInterval(function () {
      if (targetingToegestaan()) { clearInterval(timer); laadTag(); }
    }, 1000);
    setTimeout(function () { clearInterval(timer); }, 120000);
  }
})();
