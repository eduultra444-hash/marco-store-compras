require("dotenv").config();

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const axios = require("axios");

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  ActionRowBuilder
} = require("discord.js");

const REQUIRED = [
  "BOT_TOKEN",
  "CLIENT_ID",
  "GUILD_ID",
  "BASE_URL",
  "CHECKOUT_SECRET",
  "MP_ACCESS_TOKEN",
  "MP_WEBHOOK_SECRET"
];

for (const key of REQUIRED) {
  if (!process.env[key]) {
    console.error(`❌ Falta configurar ${key}.`);
    process.exit(1);
  }
}

const PORT = Number(process.env.PORT || 3000);
const BASE_URL = process.env.BASE_URL.replace(/\/+$/, "");
const PRODUCT_NAME = process.env.PRODUCT_NAME || "Produto Digital";
const PRODUCT_PRICE = Number(process.env.PRODUCT_PRICE || 5);

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// =======================================
// TOKEN DE CHECKOUT LIGADO AO USUÁRIO
// =======================================

function b64url(v) {
  return Buffer.from(v).toString("base64url");
}

function signCheckout(discordUserId) {
  const payload = {
    uid: String(discordUserId),
    exp: Date.now() + 30 * 60 * 1000,
    nonce: crypto.randomUUID()
  };

  const body = b64url(JSON.stringify(payload));

  const sig = crypto
    .createHmac("sha256", process.env.CHECKOUT_SECRET)
    .update(body)
    .digest("base64url");

  return `${body}.${sig}`;
}

function verifyCheckout(token) {
  try {
    const [body, sig] = String(token || "").split(".");
    if (!body || !sig) return null;

    const expected = crypto
      .createHmac("sha256", process.env.CHECKOUT_SECRET)
      .update(body)
      .digest("base64url");

    const a = Buffer.from(sig);
    const b = Buffer.from(expected);

    if (
      a.length !== b.length ||
      !crypto.timingSafeEqual(a, b)
    ) {
      return null;
    }

    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8")
    );

    if (!payload.uid || Date.now() > payload.exp) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function esc(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function page(title, content) {
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="wrap">
  <section class="card">
    ${content}
  </section>
</main>
</body>
</html>`;
}

// =======================================
// CONTROLE PARA NÃO ENTREGAR 2 VEZES
// =======================================

const deliveriesPath = path.join(__dirname, "deliveries.json");

function readDeliveries() {
  try {
    return JSON.parse(fs.readFileSync(deliveriesPath, "utf8"));
  } catch {
    return {};
  }
}

function alreadyDelivered(paymentId) {
  return Boolean(readDeliveries()[String(paymentId)]);
}

function markDelivered(paymentId) {
  const data = readDeliveries();

  data[String(paymentId)] = {
    deliveredAt: new Date().toISOString()
  };

  fs.writeFileSync(
    deliveriesPath,
    JSON.stringify(data, null, 2),
    "utf8"
  );
}

// =======================================
// MERCADO PAGO
// =======================================

async function getPayment(paymentId) {
  const response = await axios.get(
    `https://api.mercadopago.com/v1/payments/${encodeURIComponent(paymentId)}`,
    {
      headers: {
        Authorization: `Bearer ${process.env.MP_ACCESS_TOKEN}`
      }
    }
  );

  return response.data;
}

async function deliverIfApproved(payment) {
  if (!payment || payment.status !== "approved") {
    return false;
  }

  // Não entrega se o valor recebido não for exatamente o preço.
  if (Number(payment.transaction_amount) !== PRODUCT_PRICE) {
    console.error("❌ Valor do pagamento não corresponde ao produto.");
    return false;
  }

  const checkoutToken = payment.external_reference;
  const checkout = verifyCheckout(checkoutToken);

  if (!checkout) {
    console.error("❌ Checkout do pagamento não é válido.");
    return false;
  }

  if (alreadyDelivered(payment.id)) {
    return true;
  }

  const productPath = path.join(__dirname, "produto.txt");
  const product = fs.readFileSync(productPath, "utf8");

  const user = await client.users.fetch(checkout.uid);

  await user.send(
    `✅ **Pagamento confirmado!**\n\n` +
    `Obrigado pela compra de **${PRODUCT_NAME}**.\n` +
    `Valor: **R$ ${PRODUCT_PRICE.toFixed(2).replace(".", ",")}**\n\n` +
    `📦 **Seu produto:**\n\n` +
    "```text\n" +
    product.slice(0, 1800) +
    "\n```"
  );

  markDelivered(payment.id);

  console.log(
    `✅ Produto entregue. Pagamento=${payment.id}, Discord=${checkout.uid}`
  );

  return true;
}

// =======================================
// ASSINATURA DO WEBHOOK MERCADO PAGO
// =======================================

function verifyMercadoPagoWebhook(req) {
  try {
    const xSignature = String(req.headers["x-signature"] || "");
    const xRequestId = String(req.headers["x-request-id"] || "");

    const dataId = String(
      req.query["data.id"] ||
      req.body?.data?.id ||
      ""
    );

    if (!xSignature || !xRequestId || !dataId) {
      return false;
    }

    const parts = {};

    for (const part of xSignature.split(",")) {
      const index = part.indexOf("=");

      if (index > -1) {
        parts[part.slice(0, index).trim()] =
          part.slice(index + 1).trim();
      }
    }

    const ts = parts.ts;
    const v1 = parts.v1;

    if (!ts || !v1) {
      return false;
    }

    const manifest =
      `id:${dataId};request-id:${xRequestId};ts:${ts};`;

    const expected = crypto
      .createHmac("sha256", process.env.MP_WEBHOOK_SECRET)
      .update(manifest)
      .digest("hex");

    const a = Buffer.from(v1);
    const b = Buffer.from(expected);

    return (
      a.length === b.length &&
      crypto.timingSafeEqual(a, b)
    );
  } catch {
    return false;
  }
}

// =======================================
// COMANDO DO DISCORD
// =======================================

const commands = [
  new SlashCommandBuilder()
    .setName("painelcompras")
    .setDescription("Envia o painel de compras")
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
    .toJSON()
];

client.once("ready", async () => {
  console.log(`✅ Bot de compras online: ${client.user.tag}`);

  const rest = new REST({
    version: "10"
  }).setToken(process.env.BOT_TOKEN);

  try {
    await rest.put(
      Routes.applicationGuildCommands(
        process.env.CLIENT_ID,
        process.env.GUILD_ID
      ),
      { body: commands }
    );

    console.log("✅ /painelcompras registrado.");
  } catch (error) {
    console.error("❌ Erro ao registrar comando:", error);
  }
});

client.on("interactionCreate", async interaction => {
  if (
    interaction.isChatInputCommand() &&
    interaction.commandName === "painelcompras"
  ) {
    const embed = new EmbedBuilder()
      .setColor(0x2B7FFF)
      .setTitle(`🛒 ${PRODUCT_NAME}`)
      .setDescription(
        "Compra automática via **Pix**.\n\n" +
        "Você pode pagar usando **PicPay, Banco Inter, Nubank, Itaú, Caixa, " +
        "Bradesco, Santander** ou qualquer outro aplicativo compatível com Pix.\n\n" +
        "Após a confirmação do pagamento, o produto é enviado automaticamente no seu privado."
      )
      .addFields({
        name: "💰 Valor",
        value: `R$ ${PRODUCT_PRICE.toFixed(2).replace(".", ",")}`,
        inline: true
      })
      .setFooter({
        text: "Pagamento Pix com confirmação automática"
      });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("comprar_produto")
        .setLabel("Comprar")
        .setEmoji("🛒")
        .setStyle(ButtonStyle.Success)
    );

    await interaction.reply({
      embeds: [embed],
      components: [row]
    });

    return;
  }

  if (
    interaction.isButton() &&
    interaction.customId === "comprar_produto"
  ) {
    const checkoutToken =
      signCheckout(interaction.user.id);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setLabel(
          `Finalizar • R$ ${PRODUCT_PRICE.toFixed(2).replace(".", ",")}`
        )
        .setEmoji("💳")
        .setStyle(ButtonStyle.Link)
        .setURL(
          `${BASE_URL}/checkout?token=${encodeURIComponent(checkoutToken)}`
        )
    );

    await interaction.reply({
      content:
        "Clique abaixo para abrir o checkout Pix. " +
        "Este link é pessoal e expira em 30 minutos.",
      components: [row],
      ephemeral: true
    });
  }
});

// =======================================
// SITE
// =======================================

app.get("/", (req, res) => {
  res.send(
    page(
      "Marco Store",
      `
      <div class="brand">
        <div class="shield">🛡️</div>
        <h1>Marco Store</h1>
        <p class="muted">
          Inicie sua compra pelo botão dentro do Discord.
        </p>
      </div>
      `
    )
  );
});

app.get("/checkout", (req, res) => {
  const checkoutToken =
    String(req.query.token || "");

  if (!verifyCheckout(checkoutToken)) {
    return res
      .status(400)
      .send(
        page(
          "Link inválido",
          `
          <h1>Link inválido ou expirado</h1>
          <div class="status-wait">
            Volte ao Discord e clique em Comprar novamente.
          </div>
          `
        )
      );
  }

  res.send(
    page(
      "Finalizar compra",
      `
      <div class="brand">
        <div class="shield">🛒</div>
        <h1>Finalizar compra</h1>
        <p class="muted">${esc(PRODUCT_NAME)}</p>
      </div>

      <div class="price">
        R$ ${PRODUCT_PRICE.toFixed(2).replace(".", ",")}
      </div>

      <div class="pix">
        <b>✓ Pagamento via Pix</b>
        <p class="muted">
          O QR Code funciona em qualquer app bancário compatível com Pix.
        </p>
      </div>

      <div class="apps">
        <span class="app">PicPay</span>
        <span class="app">Banco Inter</span>
        <span class="app">Nubank</span>
        <span class="app">Itaú</span>
        <span class="app">Caixa</span>
        <span class="app">Bradesco</span>
        <span class="app">Santander</span>
        <span class="app">Outros bancos</span>
      </div>

      <form method="post" action="/criar-pix">
        <input
          type="hidden"
          name="token"
          value="${esc(checkoutToken)}"
        >

        <label>Nome</label>
        <input
          name="first_name"
          required
          maxlength="80"
          autocomplete="given-name"
        >

        <label>Sobrenome</label>
        <input
          name="last_name"
          required
          maxlength="80"
          autocomplete="family-name"
        >

        <label>E-mail</label>
        <input
          name="email"
          type="email"
          required
          maxlength="150"
          autocomplete="email"
        >

        <label>CPF — somente números</label>
        <input
          name="cpf"
          inputmode="numeric"
          pattern="[0-9]{11}"
          maxlength="11"
          required
        >

        <button type="submit">
          Gerar QR Code Pix
        </button>
      </form>

      <p class="note">
        Os dados informados são enviados ao processador de pagamento
        para criação da cobrança e não são gravados por este projeto.
      </p>
      `
    )
  );
});

app.post("/criar-pix", async (req, res) => {
  try {
    const {
      token,
      first_name,
      last_name,
      email,
      cpf
    } = req.body;

    if (!verifyCheckout(token)) {
      return res
        .status(400)
        .send(
          page(
            "Link inválido",
            "<h1>Link inválido ou expirado</h1>"
          )
        );
    }

    if (!/^[0-9]{11}$/.test(String(cpf || ""))) {
      return res
        .status(400)
        .send(
          page(
            "CPF inválido",
            "<h1>Confira o CPF informado.</h1>"
          )
        );
    }

    const idempotencyKey =
      crypto.randomUUID();

    const paymentBody = {
      transaction_amount: PRODUCT_PRICE,
      description: PRODUCT_NAME,
      payment_method_id: "pix",
      external_reference: token,

      notification_url:
        `${BASE_URL}/webhook/mercadopago`,

      payer: {
        email: String(email).trim(),
        first_name:
          String(first_name).trim(),
        last_name:
          String(last_name).trim(),

        identification: {
          type: "CPF",
          number: String(cpf)
        }
      }
    };

    const response = await axios.post(
      "https://api.mercadopago.com/v1/payments",
      paymentBody,
      {
        headers: {
          Authorization:
            `Bearer ${process.env.MP_ACCESS_TOKEN}`,

          "Content-Type":
            "application/json",

          "X-Idempotency-Key":
            idempotencyKey
        }
      }
    );

    const payment = response.data;

    const transactionData =
      payment.point_of_interaction
        ?.transaction_data || {};

    if (
      !transactionData.qr_code ||
      !transactionData.qr_code_base64
    ) {
      throw new Error(
        "A API não retornou o QR Code."
      );
    }

    let qrBase64 =
      transactionData.qr_code_base64;

    // A API normalmente retorna apenas o base64,
    // mas aceita também caso venha com prefixo.
    const qrSrc =
      qrBase64.startsWith("data:")
        ? qrBase64
        : `data:image/png;base64,${qrBase64}`;

    res.send(
      page(
        "Pague com Pix",
        `
        <div class="brand">
          <div class="shield">⚡</div>
          <h1>Pague com Pix</h1>
          <p class="muted">
            Abra PicPay, Inter ou seu aplicativo bancário e escaneie o QR Code.
          </p>
        </div>

        <div class="price">
          R$ ${PRODUCT_PRICE.toFixed(2).replace(".", ",")}
        </div>

        <img
          class="qr"
          src="${qrSrc}"
          alt="QR Code Pix"
        >

        <label>Pix Copia e Cola</label>

        <div
          class="copy"
          id="pix-code"
        >${esc(transactionData.qr_code)}</div>

        <button
          type="button"
          onclick="
            navigator.clipboard.writeText(
              document.getElementById('pix-code').innerText
            );
            this.innerText='Pix copiado!';
          "
        >
          Copiar Pix
        </button>

        <div
          id="payment-status"
          class="status-wait"
        >
          ⏳ Aguardando o pagamento...
        </div>

        <p class="note">
          Não feche esta página até a confirmação.
          Depois de aprovado, o produto também será enviado
          automaticamente no seu Discord.
        </p>

        <script>
          const paymentId =
            ${JSON.stringify(String(payment.id))};

          const checkoutToken =
            ${JSON.stringify(String(token))};

          async function checkPayment() {
            try {
              const response =
                await fetch(
                  '/status/' +
                  encodeURIComponent(paymentId) +
                  '?token=' +
                  encodeURIComponent(checkoutToken)
                );

              const result =
                await response.json();

              if (result.status === 'approved') {
                const el =
                  document.getElementById('payment-status');

                el.className =
                  'status-ok';

                el.innerText =
                  '✅ Pagamento confirmado! Confira sua DM no Discord.';

                return;
              }
            } catch (error) {}

            setTimeout(
              checkPayment,
              4000
            );
          }

          setTimeout(
            checkPayment,
            4000
          );
        </script>
        `
      )
    );
  } catch (error) {
    console.error(
      "❌ Erro criando Pix:",
      error.response?.data || error
    );

    res
      .status(500)
      .send(
        page(
          "Erro",
          `
          <h1>Não foi possível gerar o Pix</h1>
          <div class="status-wait">
            Confira a configuração da integração e tente novamente.
          </div>
          `
        )
      );
  }
});

// =======================================
// CONSULTA DO STATUS
// =======================================

app.get("/status/:paymentId", async (req, res) => {
  try {
    const token =
      String(req.query.token || "");

    if (!verifyCheckout(token)) {
      return res
        .status(403)
        .json({
          error: "invalid_checkout"
        });
    }

    const payment =
      await getPayment(
        req.params.paymentId
      );

    // Impede consulta de pagamento de outro checkout.
    if (
      payment.external_reference !== token
    ) {
      return res
        .status(403)
        .json({
          error: "payment_mismatch"
        });
    }

    if (
      payment.status === "approved"
    ) {
      await deliverIfApproved(payment)
        .catch(error =>
          console.error(
            "❌ Entrega:",
            error
          )
        );
    }

    res.json({
      status: payment.status
    });
  } catch (error) {
    console.error(
      "❌ Status:",
      error.response?.data || error
    );

    res
      .status(500)
      .json({
        error: "status_error"
      });
  }
});

// =======================================
// WEBHOOK
// =======================================

app.post(
  "/webhook/mercadopago",
  async (req, res) => {
    try {
      if (
        !verifyMercadoPagoWebhook(req)
      ) {
        return res.sendStatus(401);
      }

      const paymentId =
        String(
          req.query["data.id"] ||
          req.body?.data?.id ||
          ""
        );

      // Responde rapidamente ao provedor.
      res.sendStatus(200);

      if (!paymentId) {
        return;
      }

      // Nunca confia apenas no corpo do webhook.
      // Busca o pagamento novamente na API.
      const payment =
        await getPayment(paymentId);

      if (
        payment.status === "approved"
      ) {
        await deliverIfApproved(payment);
      }
    } catch (error) {
      console.error(
        "❌ Webhook:",
        error.response?.data || error
      );

      if (!res.headersSent) {
        res.sendStatus(500);
      }
    }
  }
);

// =======================================
// START
// =======================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `🌐 Checkout online na porta ${PORT}`
    );

    console.log(
      `🔔 Webhook: ${BASE_URL}/webhook/mercadopago`
    );
  }
);

client.login(
  process.env.BOT_TOKEN
);
