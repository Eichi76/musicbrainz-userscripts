/**
 * Kopiert den relevanten Teil einer Hoerspielforscher URL in die Zwischenablage
 */
const url = new URL(window.location);
if (url.origin == 'https://hoerspielforscher.de') {
	navigator.clipboard?.writeText(`${url.origin + url.pathname + url.search.split('&')[0]}`);
}
