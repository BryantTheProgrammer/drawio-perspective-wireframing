
// ---- Page Explorer auto-loader (appended at image build) ----
(function () {
    var tries = 0;
    var timer = setInterval(function () {
        tries++;
        if (window.Draw && typeof Draw.loadPlugin === 'function' && document.body) {
            clearInterval(timer);
            var s = document.createElement('script');
            s.src = 'plugins/page-explorer.js?v=' + Date.now();
            document.body.appendChild(s);
        } else if (tries > 150) {
            clearInterval(timer);
            console.warn('Page Explorer: draw.io UI not detected, plugin not loaded.');
        }
    }, 200);
})();
