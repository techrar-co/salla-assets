(function (w, d) {
	if (w.__techrarSallaReleaseLoaded) return;
	w.__techrarSallaReleaseLoaded = true;
	w.__techrarSallaVersion = "0.2.0";

	var s = d.createElement('script');
	s.src = "https://cdn.jsdelivr.net/gh/techrar-co/salla-assets@0.2.0/dist/salla/releases/salla-storefront-snippet.0.2.0.min.js";
	s.async = true;
	s.crossOrigin = 'anonymous';
	(d.head || d.documentElement).appendChild(s);
})(window, document);
