// Bloqr — mdBook custom JS
// Inject build timestamp next to the menu title (populated by build-info.js)
(function () {
    function injectBuildTimestamp() {
        const ts = window.__DOCS_BUILD_DATE__;
        if (!ts) return;

        // Avoid injecting twice
        if (document.getElementById('docs-build-timestamp')) return;

        const menuTitle = document.querySelector('#menu-bar .menu-title');
        if (!menuTitle) return;

        const span = document.createElement('span');
        span.id = 'docs-build-timestamp';
        span.title = 'Docs built on ' + (window.__DOCS_BUILD_TIMESTAMP__ || ts); // fallback: date-only when full ISO stamp is empty (stub/dev)
        span.textContent = ts;
        menuTitle.appendChild(span);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectBuildTimestamp);
    } else {
        injectBuildTimestamp();
    }
})();

// Rewrite page title to match Bloqr format: "Bloqr — PageTitle"
(function () {
    const title = document.title;
    const sep = ' - ';
    if (title.includes(sep)) {
        const parts = title.split(sep);
        const bookTitle = parts.pop(); // "AdBlock Compiler" or "Bloqr"
        const pageTitle = parts.join(sep);
        if (pageTitle && pageTitle !== 'Bloqr') {
            document.title = 'Bloqr \u2014 ' + pageTitle;
        }
    }
})();
