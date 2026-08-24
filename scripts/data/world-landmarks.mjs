// Pure content: world landmark coordinates for the world-landmarks pack.
// lon/lat are WGS84 decimal degrees; ids are stable slugs (never rename a
// shipped one — rooms and scores reference them). Aliases normalize by
// lowercasing and stripping [.,-] and must stay unique across features.

export const LANDMARKS = [
  // North America
  { id: "statue-of-liberty", name: "Statue of Liberty", lon: -74.0445, lat: 40.6892 },
  { id: "white-house", name: "White House", lon: -77.0353, lat: 38.8977 },
  { id: "golden-gate", name: "Golden Gate Bridge", aliases: ["Golden Gate"], lon: -122.4783, lat: 37.8199 },
  { id: "hollywood-sign", name: "Hollywood Sign", aliases: ["Hollywood"], lon: -118.3217, lat: 34.1341 },
  { id: "space-needle", name: "Space Needle", lon: -122.3493, lat: 47.6205 },
  { id: "cn-tower", name: "CN Tower", lon: -79.3832, lat: 43.6426 },
  { id: "niagara-falls", name: "Niagara Falls", lon: -79.0757, lat: 43.0799 },
  { id: "chichen-itza", name: "Chichén Itzá", aliases: ["Chichen Itza"], lon: -88.5691, lat: 20.6843 },
  { id: "panama-canal", name: "Panama Canal", lon: -79.65, lat: 9.0 },

  // South America
  { id: "christ-the-redeemer", name: "Christ the Redeemer", aliases: ["Rio Statue"], lon: -43.2105, lat: -22.9519 },
  { id: "machu-picchu", name: "Machu Picchu", lon: -72.545, lat: -13.1631 },
  { id: "iguazu-falls", name: "Iguazu Falls", lon: -54.4438, lat: -25.6863 },
  { id: "moai", name: "Moai Statues", aliases: ["Easter Island", "Rapa Nui"], lon: -109.35, lat: -27.12 },

  // Europe
  { id: "eiffel-tower", name: "Eiffel Tower", lon: 2.2945, lat: 48.8584 },
  { id: "stonehenge", name: "Stonehenge", lon: -1.8262, lat: 51.1789 },
  { id: "big-ben", name: "Big Ben", aliases: ["Elizabeth Tower", "Houses of Parliament"], lon: -0.1246, lat: 51.5007 },
  { id: "sagrada-familia", name: "Sagrada Família", aliases: ["Sagrada Familia"], lon: 2.1744, lat: 41.4036 },
  { id: "alhambra", name: "Alhambra", lon: -3.5881, lat: 37.1761 },
  { id: "brandenburg-gate", name: "Brandenburg Gate", lon: 13.3777, lat: 52.5163 },
  { id: "neuschwanstein", name: "Neuschwanstein Castle", lon: 10.7498, lat: 47.5576 },
  { id: "matterhorn", name: "Matterhorn", lon: 7.6586, lat: 45.9763 },
  { id: "colosseum", name: "Colosseum", aliases: ["Coliseum"], lon: 12.4922, lat: 41.8902 },
  { id: "leaning-tower-of-pisa", name: "Leaning Tower of Pisa", aliases: ["Tower of Pisa"], lon: 10.3965, lat: 43.723 },
  { id: "st-peters-basilica", name: "St. Peter's Basilica", aliases: ["Saint Peters Basilica", "Vatican"], lon: 12.4534, lat: 41.9029 },
  { id: "acropolis", name: "Acropolis of Athens", aliases: ["Acropolis", "Parthenon"], lon: 23.7281, lat: 37.9715 },
  { id: "hagia-sophia", name: "Hagia Sophia", lon: 28.9802, lat: 41.0086 },
  { id: "saint-basils-cathedral", name: "Saint Basil's Cathedral", aliases: ["Red Square", "Kremlin", "St Basils"], lon: 37.6231, lat: 55.7525 },

  // Africa & Middle East
  { id: "pyramids-of-giza", name: "Pyramids of Giza", aliases: ["Great Pyramid of Giza", "Giza Pyramids", "Sphinx"], lon: 31.1342, lat: 29.9792 },
  { id: "timbuktu", name: "Timbuktu", lon: -3.0026, lat: 16.7666 },
  { id: "mount-kilimanjaro", name: "Mount Kilimanjaro", aliases: ["Kilimanjaro"], lon: 37.3526, lat: -3.0674 },
  { id: "victoria-falls", name: "Victoria Falls", lon: 25.8572, lat: -17.9243 },
  { id: "table-mountain", name: "Table Mountain", lon: 18.4098, lat: -33.9628 },
  { id: "petra", name: "Petra", lon: 35.4444, lat: 30.3285 },
  { id: "dome-of-the-rock", name: "Dome of the Rock", lon: 35.2354, lat: 31.778 },
  { id: "mecca", name: "Mecca", aliases: ["Makkah", "Kaaba"], lon: 39.8262, lat: 21.4225 },
  { id: "burj-khalifa", name: "Burj Khalifa", lon: 55.2744, lat: 25.1972 },

  // Asia
  { id: "great-wall", name: "Great Wall of China", aliases: ["Great Wall"], lon: 116.0161, lat: 40.432 },
  { id: "taj-mahal", name: "Taj Mahal", lon: 78.0421, lat: 27.1751 },
  { id: "mount-everest", name: "Mount Everest", aliases: ["Everest", "Sagarmatha"], lon: 86.925, lat: 27.9881 },
  { id: "angkor-wat", name: "Angkor Wat", lon: 103.867, lat: 13.4125 },
  { id: "borobudur", name: "Borobudur", lon: 110.2038, lat: -7.6079 },
  { id: "mount-fuji", name: "Mount Fuji", aliases: ["Fuji"], lon: 138.7274, lat: 35.3606 },
  { id: "lake-baikal", name: "Lake Baikal", lon: 108.2, lat: 53.6 },

  // Oceania
  { id: "sydney-opera-house", name: "Sydney Opera House", aliases: ["Opera House"], lon: 151.2153, lat: -33.8568 },
  { id: "uluru", name: "Uluru", aliases: ["Ayers Rock"], lon: 131.0369, lat: -25.3444 },
  { id: "great-barrier-reef", name: "Great Barrier Reef", aliases: ["Barrier Reef"], lon: 147.5, lat: -17.5 },
];
