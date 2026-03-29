(function (w, d) {
	if (w.__techrarSallaBootstrapLoaded) return;
	w.__techrarSallaBootstrapLoaded = true;

	var s = d.createElement('script');
	s.src = "https://cdn.jsdelivr.net/gh/techrar-co/salla-assets@0/dist/salla/current.js";
	s.async = true;
	s.crossOrigin = 'anonymous';
	(d.head || d.documentElement).appendChild(s);
})(window, document);
