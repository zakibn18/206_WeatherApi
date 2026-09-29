require("dotenv").config();

const express = require("express");
const axios = require("axios");
const path = require("path");

const app = express();
const PORT = 3000;

app.use(express.static(path.join(__dirname, "public")));

// Helper untuk mengekstrak data lokasi secara detail dari respon MapTiler
function extractLocationDetails(feature, defaultQuery = "") {
  const coords = feature.geometry.coordinates; // [longitude, latitude]
  const ctx = feature.context || [];
  const types = feature.place_type || [];

  // Negara
  const countryObj = ctx.find((c) => c.id && c.id.startsWith("country"));
  const negara = countryObj?.text || (types.includes("country") ? feature.text : "-");

  // Provinsi
  const regionObj = ctx.find((c) => c.id && c.id.startsWith("region"));
  const provinsi = regionObj?.text || (types.includes("region") ? feature.text : "-");

  // Kecamatan / Subdistrict / District
  const subdistrictTypes = [
    "joint_municipality",
    "subdistrict",
    "neighborhood",
    "locality",
    "municipality",
  ];

  let kecObj = ctx.find(
    (c) => c.id && subdistrictTypes.some((t) => c.id.startsWith(t))
  );

  let kecamatan = "-";
  if (types.some((t) => subdistrictTypes.includes(t))) {
    kecamatan = feature.text;
  } else if (kecObj) {
    kecamatan = kecObj.text;
  } else {
    const countyObj = ctx.find((c) => c.id && c.id.startsWith("county"));
    if (countyObj) {
      kecamatan = countyObj.text;
    } else if (types.includes("county")) {
      kecamatan = feature.text;
    }
  }

  const countryCode =
    feature.properties?.country_code ||
    countryObj?.country_code ||
    "";

  return {
    query: defaultQuery,
    place_name: feature.place_name || feature.text,
    kota: feature.text,
    lokasi: feature.text,
    negara,
    provinsi,
    kecamatan,
    longitude: coords[0],
    latitude: coords[1],
    koordinat: coords,
    country_code: countryCode.toUpperCase(),
  };
}

// Mapping kondisi cuaca dari weather code WMO
function getWeatherInfo(code) {
  const codes = {
    0: { desc: "Cerah (Clear Sky)", icon: "☀️" },
    1: { desc: "Cerah Berawan", icon: "🌤️" },
    2: { desc: "Sebagian Berawan", icon: "⛅" },
    3: { desc: "Mendung Berawan", icon: "☁️" },
    45: { desc: "Berkabut", icon: "🌫️" },
    48: { desc: "Kabut Tebal", icon: "🌫️" },
    51: { desc: "Gerimis Ringan", icon: "🌦️" },
    53: { desc: "Gerimis Sedang", icon: "🌦️" },
    55: { desc: "Gerimis Lebat", icon: "🌧️" },
    61: { desc: "Hujan Ringan", icon: "🌧️" },
    63: { desc: "Hujan Sedang", icon: "🌧️" },
    65: { desc: "Hujan Deras", icon: "🌧️" },
    80: { desc: "Hujan Lokal", icon: "🌦️" },
    95: { desc: "Badai Petir", icon: "⛈️" },
  };
  return codes[code] || { desc: "Normal / Berawan", icon: "🌤️" };
}

// Endpoint konfigurasi untuk frontend (misal API key untuk map tiles)
app.get("/api/config", (req, res) => {
  res.json({
    maptilerApiKey: process.env.MAPTILER_API_KEY || "",
  });
});

// Endpoint data lokasi & cuaca
app.get("/api/lokasi", async (req, res) => {
  const apikey = process.env.MAPTILER_API_KEY;
  const baseUrl =
    process.env.MAPTILER_BASE_URL ||
    process.env.MAPTILER_BASEURL ||
    "https://api.maptiler.com/geocoding";

  const { kota, lat, lon } = req.query;

  let queryEndpoint = "";
  if (lat && lon) {
    queryEndpoint = `${lon},${lat}.json?key=${apikey}`;
  } else {
    const searchTarget = kota || "Bandung City";
    queryEndpoint = `${encodeURIComponent(searchTarget)}.json?key=${apikey}`;
  }

  const url = `${baseUrl}/${queryEndpoint}`;

  try {
    const response = await axios.get(url);
    const data = response.data;

    if (!data.features || data.features.length === 0) {
      return res.status(404).json({
        success: false,
        message: "Lokasi tidak ditemukan.",
      });
    }

    const feature = data.features[0];
    const details = extractLocationDetails(feature, kota || feature.text);

    // Ambil data cuaca realtime berdasarkan koordinat (Weather API)
    let weatherData = null;
    try {
      const weatherRes = await axios.get(
        `https://api.open-meteo.com/v1/forecast?latitude=${details.latitude}&longitude=${details.longitude}&current_weather=true`
      );
      if (weatherRes.data && weatherRes.data.current_weather) {
        const cur = weatherRes.data.current_weather;
        const info = getWeatherInfo(cur.weathercode);
        weatherData = {
          temperature: cur.temperature,
          windspeed: cur.windspeed,
          condition: info.desc,
          icon: info.icon,
          weathercode: cur.weathercode,
          isDay: cur.is_day === 1,
        };
      }
    } catch (wErr) {
      console.warn("Peringatan cuaca (non-critical):", wErr.message);
    }

    res.json({
      success: true,
      ...details,
      weather: weatherData,
      maptilerApiKey: apikey,
    });
  } catch (error) {
    console.error("Gagal mengambil data dari Maptiler:", error.message);
    res.status(500).json({
      success: false,
      message: "Gagal mengambil data dari Maptiler",
      error: error.message,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server berjalan di http://localhost:${PORT}`);
});