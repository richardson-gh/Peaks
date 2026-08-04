/**
 * Convert a British OS National Grid reference (e.g. "NY215072") to a
 * WGS84 latitude/longitude pair, suitable for plotting on a standard
 * web map (Leaflet/OpenStreetMap).
 *
 * Implements the standard published Ordnance Survey algorithm:
 *   1. Grid letters + digits -> OSGB36 easting/northing
 *   2. OSGB36 easting/northing -> OSGB36 lat/lon (Airy 1830 ellipsoid,
 *      inverse Transverse Mercator, Redfearn series)
 *   3. OSGB36 lat/lon -> WGS84 lat/lon (Helmert 7-parameter datum
 *      transform via 3D cartesian coordinates)
 */
(function (global) {
  'use strict';

  function gridRefToEastingNorthing(gridRef) {
    const ref = gridRef.toUpperCase().replace(/\s+/g, '');
    const m = /^([A-Z]{2})(\d+)$/.exec(ref);
    if (!m) return null;
    const letters = m[1];
    const digits = m[2];
    if (digits.length % 2 !== 0) return null;
    const half = digits.length / 2;
    const eastDigits = digits.slice(0, half);
    const northDigits = digits.slice(half);
    const scale = 5 - half; // digits.length 10 -> scale0 (1m), 6 -> scale2 (100m), etc.
    const eastWithin = Number(eastDigits) * Math.pow(10, scale);
    const northWithin = Number(northDigits) * Math.pow(10, scale);

    let l1 = letters.charCodeAt(0) - 65;
    let l2 = letters.charCodeAt(1) - 65;
    if (l1 > 7) l1--; // letter 'I' is skipped in grid lettering
    if (l2 > 7) l2--;

    const e100km = (((l1 - 2) % 5) * 5 + (l2 % 5)) * 100000;
    const n100km = ((19 - Math.floor(l1 / 5) * 5) - Math.floor(l2 / 5)) * 100000;

    return { easting: e100km + eastWithin, northing: n100km + northWithin };
  }

  // OSGB36 easting/northing -> OSGB36 lat/lon (degrees), via inverse Transverse Mercator.
  function gridToOsgb36LatLon(easting, northing) {
    const a = 6377563.396, b = 6356256.909; // Airy 1830 ellipsoid
    const F0 = 0.9996012717; // National Grid scale factor on central meridian
    const lat0 = (49 * Math.PI) / 180;
    const lon0 = (-2 * Math.PI) / 180;
    const N0 = -100000, E0 = 400000;
    const e2 = 1 - (b * b) / (a * a);
    const n = (a - b) / (a + b), n2 = n * n, n3 = n * n * n;

    let lat = lat0;
    let M = 0;
    do {
      lat = (northing - N0 - M) / (a * F0) + lat;
      const Ma = (1 + n + (5 / 4) * n2 + (5 / 4) * n3) * (lat - lat0);
      const Mb = (3 * n + 3 * n * n + (21 / 8) * n3) * Math.sin(lat - lat0) * Math.cos(lat + lat0);
      const Mc = ((15 / 8) * n2 + (15 / 8) * n3) * Math.sin(2 * (lat - lat0)) * Math.cos(2 * (lat + lat0));
      const Md = (35 / 24) * n3 * Math.sin(3 * (lat - lat0)) * Math.cos(3 * (lat + lat0));
      M = b * F0 * (Ma - Mb + Mc - Md);
    } while (Math.abs(northing - N0 - M) >= 0.00001);

    const cosLat = Math.cos(lat), sinLat = Math.sin(lat);
    const nu = (a * F0) / Math.sqrt(1 - e2 * sinLat * sinLat);
    const rho = (a * F0 * (1 - e2)) / Math.pow(1 - e2 * sinLat * sinLat, 1.5);
    const eta2 = nu / rho - 1;

    const tanLat = Math.tan(lat);
    const tan2lat = tanLat * tanLat, tan4lat = tan2lat * tan2lat, tan6lat = tan4lat * tan2lat;
    const secLat = 1 / cosLat;
    const nu3 = nu * nu * nu, nu5 = nu3 * nu * nu, nu7 = nu5 * nu * nu;

    const VII = tanLat / (2 * rho * nu);
    const VIII = (tanLat / (24 * rho * nu3)) * (5 + 3 * tan2lat + eta2 - 9 * tan2lat * eta2);
    const IX = (tanLat / (720 * rho * nu5)) * (61 + 90 * tan2lat + 45 * tan4lat);
    const X = secLat / nu;
    const XI = (secLat / (6 * nu3)) * (nu / rho + 2 * tan2lat);
    const XII = (secLat / (120 * nu5)) * (5 + 28 * tan2lat + 24 * tan4lat);
    const XIIA = (secLat / (5040 * nu7)) * (61 + 662 * tan2lat + 1320 * tan4lat + 720 * tan6lat);

    const dE = easting - E0;
    const dE2 = dE * dE, dE3 = dE2 * dE, dE4 = dE2 * dE2, dE5 = dE3 * dE2, dE6 = dE4 * dE2, dE7 = dE5 * dE2;

    const finalLat = lat - VII * dE2 + VIII * dE4 - IX * dE6;
    const finalLon = lon0 + X * dE - XI * dE3 + XII * dE5 - XIIA * dE7;

    return { lat: (finalLat * 180) / Math.PI, lon: (finalLon * 180) / Math.PI, ellipsoid: 'airy1830' };
  }

  // Helmert transform helpers: geodetic <-> cartesian, plus the OSGB36->WGS84 parameters.
  function geodeticToCartesian(lat, lon, h, a, b) {
    const phi = (lat * Math.PI) / 180, lambda = (lon * Math.PI) / 180;
    const e2 = 1 - (b * b) / (a * a);
    const sinPhi = Math.sin(phi), cosPhi = Math.cos(phi);
    const nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
    const x = (nu + h) * cosPhi * Math.cos(lambda);
    const y = (nu + h) * cosPhi * Math.sin(lambda);
    const z = (nu * (1 - e2) + h) * sinPhi;
    return { x, y, z };
  }

  function cartesianToGeodetic(x, y, z, a, b) {
    const e2 = 1 - (b * b) / (a * a);
    const p = Math.sqrt(x * x + y * y);
    let phi = Math.atan2(z, p * (1 - e2));
    let nu;
    for (let i = 0; i < 10; i++) {
      const sinPhi = Math.sin(phi);
      nu = a / Math.sqrt(1 - e2 * sinPhi * sinPhi);
      const phiNext = Math.atan2(z + e2 * nu * sinPhi, p);
      if (Math.abs(phiNext - phi) < 1e-12) { phi = phiNext; break; }
      phi = phiNext;
    }
    const lambda = Math.atan2(y, x);
    return { lat: (phi * 180) / Math.PI, lon: (lambda * 180) / Math.PI };
  }

  // OSGB36 -> WGS84 Helmert parameters (published by Ordnance Survey).
  const HELMERT = {
    tx: 446.448, ty: -125.157, tz: 542.060,
    s: -20.4894, // ppm
    rx: 0.1502, ry: 0.2470, rz: 0.8421, // seconds of arc
  };

  function osgb36ToWgs84(lat, lon) {
    const a1 = 6377563.396, b1 = 6356256.909; // Airy 1830
    const a2 = 6378137.000, b2 = 6356752.3141; // WGS84
    const c = geodeticToCartesian(lat, lon, 0, a1, b1);

    const s1 = HELMERT.s / 1e6 + 1;
    const rx = (HELMERT.rx / 3600) * (Math.PI / 180);
    const ry = (HELMERT.ry / 3600) * (Math.PI / 180);
    const rz = (HELMERT.rz / 3600) * (Math.PI / 180);

    const x2 = HELMERT.tx + c.x * s1 - c.y * rz + c.z * ry;
    const y2 = HELMERT.ty + c.x * rz + c.y * s1 - c.z * rx;
    const z2 = HELMERT.tz - c.x * ry + c.y * rx + c.z * s1;

    return cartesianToGeodetic(x2, y2, z2, a2, b2);
  }

  function gridRefToLatLon(gridRef) {
    const en = gridRefToEastingNorthing(gridRef);
    if (!en) return null;
    const osgb36 = gridToOsgb36LatLon(en.easting, en.northing);
    const wgs84 = osgb36ToWgs84(osgb36.lat, osgb36.lon);
    return { lat: wgs84.lat, lon: wgs84.lon };
  }

  global.OSGB = { gridRefToLatLon, gridRefToEastingNorthing };
})(window);
