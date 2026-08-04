/**
 * Seed data: the highest point of each of the 48 ceremonial counties of
 * England, per https://en.wikipedia.org/wiki/List_of_ceremonial_counties_of_England_by_highest_point
 * Lat/lon is derived at seed time from the OS grid reference (see osgb.js).
 */
(function (global) {
  'use strict';

  const COUNTY_TOPS = [
    ['Cumbria', 978, 'Scafell Pike', 'NY215072'],
    ['Northumberland', 815, 'The Cheviot', 'NT909205'],
    ['Durham', 788, 'Mickle Fell', 'NY805245'],
    ['North Yorkshire', 736, 'Whernside', 'SD738814'],
    ['Herefordshire', 703, 'Black Mountain', 'SO255350'],
    ['Derbyshire', 636, 'Kinder Scout', 'SK085875'],
    ['Lancashire', 628, 'Green Hill', 'SD701820'],
    ['Devon', 621, 'High Willhays', 'SX580892'],
    ['West Yorkshire', 582, 'Black Hill', 'SE078046'],
    ['Cheshire', 559, 'Shining Tor', 'SJ994737'],
    ['South Yorkshire', 548, 'High Stones', 'SK188943'],
    ['Greater Manchester', 542, 'Black Chew Head', 'SE056019'],
    ['Shropshire', 540, 'Brown Clee Hill', 'SO593865'],
    ['Staffordshire', 520, 'Cheeks Hill', 'SK026699'],
    ['Somerset', 519, 'Dunkery Beacon', 'SS891415'],
    ['Worcestershire', 425, 'Worcestershire Beacon', 'SO768452'],
    ['Cornwall', 420, 'Brown Willy', 'SX158800'],
    ['Gloucestershire', 330, 'Cleeve Hill', 'SO996245'],
    ['Berkshire', 297, 'Walbury Hill', 'SU373616'],
    ['Surrey', 295, 'Leith Hill', 'TQ139431'],
    ['Wiltshire', 294, 'Milk Hill', 'SU104643'],
    ['Hampshire', 286, 'Pilot Hill', 'SU398601'],
    ['West Sussex', 280, 'Black Down', 'SU919296'],
    ['Dorset', 279, 'Lewesdon Hill', 'ST437011'],
    ['Leicestershire', 278, 'Bardon Hill', 'SK459131'],
    ['West Midlands', 271, 'Turners Hill', 'SO967887'],
    ['Buckinghamshire', 267, 'Haddington Hill', 'SP890090'],
    ['Oxfordshire', 261, 'Whitehorse Hill', 'SU300863'],
    ['Warwickshire', 261, 'Ebrington Hill', 'SP187426'],
    ['Tyne and Wear', 259, 'Currock Hill', 'NZ107592'],
    ['Kent', 251, "Betsom's Hill", 'TQ435563'],
    ['East Sussex', 248, 'Ditchling Beacon', 'TQ331130'],
    ['East Riding of Yorkshire', 246, 'Bishop Wilton Wold', 'SE821570'],
    ['Greater London', 245, 'Westerham Heights', 'TQ436564'],
    ['Hertfordshire', 244, 'Pavis Wood', 'SP914091'],
    ['Bedfordshire', 243, 'Dunstable Downs', 'TL008194'],
    ['Isle of Wight', 241, 'St Boniface Down', 'SZ569785'],
    ['Northamptonshire', 225, 'Arbury Hill', 'SP540587'],
    ['Nottinghamshire', 204, 'Newtonwood Lane', 'SK456606'],
    ['Rutland', 197, 'Cold Overton Park', 'SK827085'],
    ['Merseyside', 179, 'Billinge Hill', 'SD525014'],
    ['Lincolnshire', 168, 'Normanby le Wold Top', 'TF121964'],
    ['Bristol', 160, 'Dundry Hill', 'ST593668'],
    ['Essex', 147, 'Chrishall Common', 'TL443362'],
    ['Cambridgeshire', 146, 'Great Chishill', 'TL427386'],
    ['Suffolk', 128, 'Great Wood Hill', 'TL786558'],
    ['Norfolk', 103, 'Beacon Hill', 'TG183414'],
    ['City of London', 22, 'High Holborn', 'TQ310816'],
  ];

  function buildSeedPeaks() {
    return COUNTY_TOPS.map(([county, height, name, gridRef]) => {
      const coords = global.OSGB.gridRefToLatLon(gridRef);
      return {
        name,
        relevance: `${county} Top`,
        height,
        gridRef,
        lat: coords ? Number(coords.lat.toFixed(6)) : null,
        lon: coords ? Number(coords.lon.toFixed(6)) : null,
        notes: '',
        visited: false,
        visitedAt: null,
      };
    });
  }

  global.SEED_PEAKS = buildSeedPeaks;
})(window);
