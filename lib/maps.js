// Map research data: POIs + vehicle routes for Brookhaven RP and Welcome to Bloxburg.
// Sources: brookhavenrp.com, welcome-to-bloxburg.fandom.com (Minimap/Interactive Map), heybloxburg.com
// Coordinate space is 0..1000 on both axes (SVG viewBox).

const MAPS = {
  brookhaven: {
    id: 'brookhaven',
    name: 'Brookhaven RP',
    placeId: 4924922222,
    credit: 'Brookhaven by Voldex',
    blurb: 'Town fountain spawn, St Luke\'s Hospital, Haven Plaza, airport, beach and the 2026 prison.',
    water: [
      { x: 0, y: 720, w: 1000, h: 280 },
      { x: 470, y: 250, w: 210, h: 170 }
    ],
    zones: [
      { x: 40, y: 40, w: 300, h: 240, label: 'Residential', color: '#1e3a2f' },
      { x: 380, y: 60, w: 300, h: 250, label: 'Downtown', color: '#3b2f52' },
      { x: 720, y: 50, w: 240, h: 260, label: 'Airport', color: '#2c3e57' },
      { x: 60, y: 330, w: 320, h: 300, label: 'Suburban', color: '#27412f' },
      { x: 430, y: 340, w: 300, h: 300, label: 'Commercial', color: '#4a3b23' },
      { x: 760, y: 350, w: 200, h: 280, label: 'Industrial', color: '#40333a' },
      { x: 40, y: 670, w: 640, h: 280, label: 'Beach & Lake', color: '#164a5e' },
      { x: 700, y: 660, w: 260, h: 290, label: 'Hills', color: '#2c4a1f' }
    ],
    pois: [
      { id: 'fountain', name: 'Town Fountain (Spawn)', cat: 'landmark', x: 520, y: 195 },
      { id: 'hospital', name: "St Luke's Hospital", cat: 'medical', x: 430, y: 130 },
      { id: 'fire', name: 'Fire Station', cat: 'service', x: 610, y: 140 },
      { id: 'school', name: 'Brookhaven High School', cat: 'school', x: 300, y: 430 },
      { id: 'police', name: 'Police Station', cat: 'service', x: 665, y: 245 },
      { id: 'bank', name: 'Brookhaven Bank', cat: 'shop', x: 575, y: 300 },
      { id: 'mall', name: 'Haven Plaza (Mall)', cat: 'shop', x: 500, y: 420 },
      { id: 'grocery', name: 'Grocery Store', cat: 'shop', x: 415, y: 505 },
      { id: 'airport', name: 'Airport Hangar', cat: 'transport', x: 835, y: 135 },
      { id: 'prison', name: 'The Prison (2026)', cat: 'service', x: 865, y: 470 },
      { id: 'beach', name: 'The Beach', cat: 'fun', x: 250, y: 800 },
      { id: 'lake', name: 'Town Lake', cat: 'fun', x: 575, y: 335 },
      { id: 'gas', name: 'Gas Station', cat: 'transport', x: 345, y: 330 },
      { id: 'carwash', name: 'Car Wash', cat: 'transport', x: 730, y: 560 },
      { id: 'adoption', name: 'Adoption Center', cat: 'service', x: 250, y: 155 },
      { id: 'pets', name: 'Pet Hospital', cat: 'medical', x: 185, y: 105 },
      { id: 'post', name: 'Post Office', cat: 'service', x: 315, y: 95 },
      { id: 'museum', name: 'Museum', cat: 'fun', x: 145, y: 245 },
      { id: 'arcade', name: 'Arcade', cat: 'fun', x: 645, y: 385 },
      { id: 'mansion', name: 'Spooky Mansion', cat: 'fun', x: 845, y: 745 },
      { id: 'cemetery', name: 'Cemetery', cat: 'fun', x: 905, y: 640 },
      { id: 'wifi-downtown', name: 'FREE WIFI - Downtown', cat: 'wifi', x: 520, y: 250 },
      { id: 'wifi-mall', name: 'FREE WIFI - Haven Plaza', cat: 'wifi', x: 470, y: 455 },
      { id: 'wifi-beach', name: 'FREE WIFI - Beach', cat: 'wifi', x: 300, y: 760 },
      { id: 'wifi-airport', name: 'FREE WIFI - Airport', cat: 'wifi', x: 800, y: 200 }
    ],
    routes: [
      { id: 'b1', name: 'Bus 1 - Downtown Loop', color: '#4dd2ff', stops: [[150, 300], [430, 330], [520, 250], [650, 300], [760, 430], [640, 560], [430, 520], [300, 430], [200, 360], [150, 300]] },
      { id: 'b2', name: 'Bus 2 - Airport Express', color: '#7dd3fc', stops: [[520, 250], [660, 210], [790, 200], [860, 140], [790, 200], [660, 210], [520, 250]] },
      { id: 'c1', name: 'Taxi 1 - Beach Route', color: '#ffd166', stops: [[345, 330], [300, 430], [250, 560], [250, 760], [420, 830], [560, 700], [520, 480], [520, 250], [345, 330]] },
      { id: 'c2', name: 'Taxi 2 - Prison Run', color: '#f9a825', stops: [[575, 300], [700, 350], [865, 470], [905, 640], [760, 560], [650, 430], [575, 300]] },
      { id: 'v1', name: 'Car - Residential', color: '#ef5da8', stops: [[150, 150], [300, 200], [430, 130], [300, 430], [150, 350], [150, 150]] },
      { id: 'v2', name: 'Car - Highway 7', color: '#a78bfa', stops: [[120, 620], [430, 640], [700, 620], [900, 560], [930, 300], [700, 250], [430, 300], [120, 620]] }
    ]
  },

  bloxburg: {
    id: 'bloxburg',
    name: 'Welcome to Bloxburg',
    placeId: 185655149,
    credit: 'Bloxburg Development / Coffee Stain',
    blurb: 'Town Hall, BFF Supermarket, Peak Mountain, the Pier, Gazblox and every bus stop.',
    water: [
      { x: 0, y: 760, w: 1000, h: 240 },
      { x: 640, y: 430, w: 360, h: 190 }
    ],
    zones: [
      { x: 40, y: 40, w: 300, h: 280, label: 'Peak Mountain', color: '#2f4127' },
      { x: 380, y: 60, w: 320, h: 250, label: 'City Centre', color: '#40345c' },
      { x: 740, y: 50, w: 220, h: 260, label: 'Greenfield', color: '#1f4a2c' },
      { x: 60, y: 360, w: 330, h: 300, label: 'Riverside', color: '#24485c' },
      { x: 430, y: 350, w: 300, h: 300, label: 'Downtown', color: '#4a3b23' },
      { x: 760, y: 340, w: 200, h: 260, label: 'Industrial', color: '#41343b' },
      { x: 40, y: 700, w: 640, h: 250, label: 'Beach & Pier', color: '#16556b' },
      { x: 700, y: 660, w: 260, h: 290, label: 'Sunset Pointe', color: '#3a2f52' }
    ],
    pois: [
      { id: 'townhall', name: 'Bloxburg Town Hall', cat: 'landmark', x: 520, y: 195 },
      { id: 'theater', name: 'Bloxburg Movie Theater', cat: 'fun', x: 645, y: 300 },
      { id: 'bff', name: 'BFF Supermarket', cat: 'shop', x: 445, y: 300 },
      { id: 'stylez', name: 'Stylez Hair Studio', cat: 'shop', x: 555, y: 355 },
      { id: 'beat', name: 'Beat Nightclub', cat: 'fun', x: 645, y: 420 },
      { id: 'gym', name: 'Bloxburg Gym', cat: 'service', x: 395, y: 375 },
      { id: 'furniture', name: 'Fancy Furniture', cat: 'shop', x: 470, y: 465 },
      { id: 'gazblox', name: 'Gazblox Gas Station', cat: 'transport', x: 345, y: 430 },
      { id: 'mikes', name: "Mike's Motors", cat: 'transport', x: 745, y: 365 },
      { id: 'pizza', name: 'Pizza Planet', cat: 'job', x: 705, y: 245 },
      { id: 'school', name: 'Bloxburg High School', cat: 'school', x: 300, y: 245 },
      { id: 'benice', name: "Ben's Ice Cream", cat: 'fun', x: 255, y: 800 },
      { id: 'ferris', name: 'Ferris Wheel (Beach)', cat: 'fun', x: 190, y: 760 },
      { id: 'pier', name: 'Bloxburg Pier', cat: 'fun', x: 430, y: 855 },
      { id: 'pool', name: 'Community Pool', cat: 'fun', x: 620, y: 815 },
      { id: 'park', name: 'Riverside Park', cat: 'fun', x: 155, y: 565 },
      { id: 'lighthouse', name: 'Cape Beacon Lighthouse', cat: 'landmark', x: 905, y: 745 },
      { id: 'obs', name: 'Starlight Observatory', cat: 'fun', x: 855, y: 640 },
      { id: 'peak', name: 'Peak Mountain', cat: 'landmark', x: 175, y: 135 },
      { id: 'falls', name: 'Meh-Meh Falls', cat: 'landmark', x: 95, y: 235 },
      { id: 'greenfield', name: 'Greenfield Plains', cat: 'landmark', x: 835, y: 165 },
      { id: 'graveyard', name: 'Graveyard', cat: 'fun', x: 135, y: 355 },
      { id: 'burger', name: 'Blox Burgers', cat: 'job', x: 590, y: 245 },
      { id: 'bus-stop', name: 'Bloxburg Central Bus Stop', cat: 'transport', x: 505, y: 265 },
      { id: 'wifi-city', name: 'FREE WIFI - City Centre', cat: 'wifi', x: 520, y: 250 },
      { id: 'wifi-pier', name: 'FREE WIFI - Pier', cat: 'wifi', x: 400, y: 830 },
      { id: 'wifi-peak', name: 'FREE WIFI - Peak Mountain', cat: 'wifi', x: 235, y: 190 },
      { id: 'wifi-beach', name: 'FREE WIFI - Beach', cat: 'wifi', x: 300, y: 750 }
    ],
    routes: [
      { id: 'b1', name: 'Bus 1 - Central Circle', color: '#4dd2ff', stops: [[505, 265], [645, 300], [745, 365], [705, 245], [520, 195], [445, 300], [345, 430], [505, 265]] },
      { id: 'b2', name: 'Bus 2 - Coastal Line', color: '#7dd3fc', stops: [[155, 565], [255, 760], [430, 855], [620, 815], [905, 745], [855, 640], [700, 500], [430, 500], [155, 565]] },
      { id: 'b3', name: 'Bus 3 - Mountain Route', color: '#8ecfff', stops: [[175, 135], [95, 235], [300, 245], [345, 430], [505, 265], [300, 245], [175, 135]] },
      { id: 'c1', name: 'Taxi 1 - Downtown Dash', color: '#ffd166', stops: [[445, 300], [555, 355], [645, 420], [590, 245], [520, 195], [445, 300]] },
      { id: 'c2', name: 'Taxi 2 - Late Night Run', color: '#f9a825', stops: [[645, 420], [745, 365], [855, 640], [905, 745], [620, 815], [430, 855], [430, 500], [645, 420]] },
      { id: 'v1', name: 'Car - Suburban Cruise', color: '#ef5da8', stops: [[300, 245], [430, 350], [470, 465], [345, 430], [300, 245]] },
      { id: 'v2', name: 'Car - Innerloop Highway', color: '#a78bfa', stops: [[100, 620], [430, 500], [700, 500], [930, 460], [930, 200], [700, 130], [430, 130], [150, 200], [100, 620]] }
    ]
  }
};

function getMap(id) {
  return MAPS[id] || null;
}

module.exports = { MAPS, getMap };
