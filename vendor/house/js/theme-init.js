/* House theme pre-paint: <script src="js/theme-init.js"></script> in <head>. Dark unless stored 'light'; never reads prefers-color-scheme. */
(function () {
  var t = "dark";
  try { if (localStorage.getItem("theme") === "light") t = "light"; } catch {}
  document.documentElement.setAttribute("data-theme", t);
  try { var p = localStorage.getItem("palette"); if (p === "peach" || p === "lavender") document.documentElement.setAttribute("data-palette", p); } catch {}
  try { var logo = localStorage.getItem("logo-form"); if (logo === "short" || logo === "middle" || logo === "long") document.documentElement.setAttribute("data-logo", logo); } catch {}
  var m = document.querySelector('meta[name="theme-color"]');
  if (m) m.setAttribute("content", t === "light" ? "#eef7f1" : "#11150e");
})();
