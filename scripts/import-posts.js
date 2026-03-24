const fs = require("fs");
const axios = require("axios");

require("dotenv").config();

const STRAPI_URL = process.env.STRAPI_URL + "/api";
const TOKEN = process.env.STRAPI_TOKEN;

const HEADERS = {
  Authorization: `Bearer ${TOKEN}`,
};

// 🔹 carregar backup
const rawData = JSON.parse(fs.readFileSync("backup.json", "utf-8"));

// suporta tanto { data: [...] } quanto array direto
const posts = rawData.data || rawData;

// delay pra evitar rate limit
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function createPost(post) {
  const attr = post.attributes || post;

  try {
    const payload = {
      title: attr.title,
      summary: attr.summary,
      metaTitle: attr.metaTitle,
      metaDescription: attr.metaDescription,
      slugId: attr.slugId,
      readingTime: attr.readingTime,
      type: attr.type,
      videoUrl: attr.videoUrl,
      richMaterialUrl: attr.richMaterialUrl,
      content: attr.content,
      locale: attr.locale || "pt",

      // relações simples (ajuste se necessário)
      // author: attr.author?.id,
      topic: attr.topic?.documentId,
      image: attr.image?.id,
      imageMobile: attr.imageMobile?.id,
    };

    console.log(`🚀 Criando post: ${payload.title}`);

    const res = await axios.post(
      `${STRAPI_URL}/posts`,
      { data: payload },
      { headers: HEADERS },
    );

    console.log("✅ Criado:", res.data.data.id);
  } catch (err) {
    console.log("❌ Erro ao criar:", attr.title);
    console.log(err.response?.data || err.message);
  }
}

async function run() {
  for (const post of posts) {
    await createPost(post);
    await sleep(500); // evita rate limit
  }

  console.log("\n🎯 Importação finalizada");
}

run();
