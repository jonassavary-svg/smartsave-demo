(function () {
  if (location.protocol === 'file:') {
    return;
  }
  if (typeof EventSource === 'undefined') {
    return;
  }

  // Force cache-busting on all pages and assets to avoid iOS home-screen caching.
  var params = new URLSearchParams(location.search);
  var devReload = params.get('__devReload');
  var cacheKey = devReload || params.get('ts');
  if (!cacheKey) {
    cacheKey = String(Date.now());
    params.set('ts', cacheKey);
    var nextUrl = location.pathname + '?' + params.toString() + location.hash;
    location.replace(nextUrl);
    return;
  }

  var cacheParamName = devReload ? '__devReload' : 'ts';
  var cacheParamValue = devReload || cacheKey;

  var updateUrl = function (url) {
    if (!url) return url;
    if (url.indexOf('data:') === 0 || url.indexOf('blob:') === 0 || url.indexOf('javascript:') === 0) {
      return url;
    }
    var u = new URL(url, location.href);
    if (u.origin !== location.origin) return url;
    u.searchParams.set(cacheParamName, cacheParamValue);
    return u.pathname + u.search + u.hash;
  };

  var nodes = document.querySelectorAll('script[src], link[rel="stylesheet"][href], link[rel="manifest"][href]');
  for (var i = 0; i < nodes.length; i++) {
    var node = nodes[i];
    if (node.tagName === 'SCRIPT') {
      var nextSrc = updateUrl(node.getAttribute('src'));
      if (nextSrc && nextSrc !== node.getAttribute('src')) {
        node.setAttribute('src', nextSrc);
      }
    } else if (node.tagName === 'LINK') {
      var nextHref = updateUrl(node.getAttribute('href'));
      if (nextHref && nextHref !== node.getAttribute('href')) {
        node.setAttribute('href', nextHref);
      }
    }
  }

  var links = document.querySelectorAll('a[href]');
  for (var j = 0; j < links.length; j++) {
    var link = links[j];
    var href = link.getAttribute('href');
    if (!href || href[0] === '#') continue;
    if (href.indexOf('mailto:') === 0 || href.indexOf('tel:') === 0 || href.indexOf('javascript:') === 0) {
      continue;
    }
    var targetUrl = new URL(href, location.href);
    if (targetUrl.origin !== location.origin) continue;
    var path = targetUrl.pathname || '';
    if (!(path === '/' || path.endsWith('.html'))) continue;
    var nextLink = updateUrl(href);
    if (nextLink && nextLink !== href) {
      link.setAttribute('href', nextLink);
    }
  }

  var source = new EventSource('/__reload');
  source.onmessage = function (evt) {
    if (!evt || !evt.data) return;
    if (evt.data === 'reload') {
      var ts = Date.now();
      var base = location.pathname + location.search;
      var glue = base.indexOf('?') === -1 ? '?' : '&';
      var next = base + glue + '__devReload=' + ts + location.hash;
      location.replace(next);
    }
  };
  source.onerror = function () {
    // If the dev server is not running, silently ignore.
  };
})();
