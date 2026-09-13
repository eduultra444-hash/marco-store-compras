# Marco Store — Pix Universal

## O que este projeto faz

- Bot Discord separado para compras.
- Comando `/painelcompras`.
- Botão Comprar.
- Página de checkout.
- Pagamento somente via Pix.
- QR Code e Pix Copia e Cola.
- O comprador pode pagar pelo PicPay, Banco Inter, Nubank, Itaú, Caixa, Bradesco, Santander ou qualquer app com Pix.
- Confirmação automática pela API do processador.
- Entrega automática por DM.
- Conteúdo entregue vem do arquivo `produto.txt`.
- Proteção contra entrega duplicada.

## Importante sobre PicPay, Inter e outros bancos

Pix é interoperável.

Isso significa que NÃO é necessário conectar a API do PicPay ou do Banco Inter só porque o comprador usa esses aplicativos.

Exemplo:
- a cobrança é gerada pela sua integração Pix;
- o cliente abre PicPay;
- escaneia o mesmo QR;
- paga normalmente.

O mesmo vale para Banco Inter, Nubank e outros bancos.

Uma integração separada com PicPay Empresas ou Banco Inter Empresas só é necessária se VOCÊ quiser que o sistema de cobrança/recebimento seja operado diretamente pela sua conta empresarial nesses provedores.

## Configuração

### 1. Discord

Crie outro bot separado no Discord Developer Portal.

Você precisa de:

BOT_TOKEN
CLIENT_ID
GUILD_ID

Instale com os scopes:

bot
applications.commands

Depois execute:

/painelcompras

### 2. Produto

Abra:

produto.txt

Troque o texto pelo produto digital legítimo que será entregue.

### 3. Render

Build Command:

npm install

Start Command:

npm start

Variáveis:

BOT_TOKEN
CLIENT_ID
GUILD_ID
BASE_URL
CHECKOUT_SECRET
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
PRODUCT_NAME
PRODUCT_PRICE

Preço de R$ 5:

PRODUCT_PRICE=5.00

Exemplo do BASE_URL:

https://marco-store-compras.onrender.com

### 4. Mercado Pago

Portal oficial:

https://www.mercadopago.com.br/developers/

Documentação oficial Pix:

https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix

Configure o webhook para:

https://SEU-SERVICO.onrender.com/webhook/mercadopago

Eventos de pagamento devem estar habilitados.

### 5. PicPay Empresas — opcional para o RECEBEDOR

Não é necessário para um cliente pagar usando o app PicPay.

Documentação oficial da API Pix PicPay:

https://developers-business.picpay.com/pix/docs/introduction

Cobrança Pix:

https://developers-business.picpay.com/pix/docs/api/charge-pix

Autenticação:

https://developers-business.picpay.com/pix/docs/api/authentication

### 6. Banco Inter Empresas — opcional para o RECEBEDOR

Não é necessário para um cliente pagar usando o app Banco Inter.

Portal oficial:

https://developers.inter.co/

API Pix Inter Empresas:

https://inter.co/empresas/api-pix/

A integração empresarial do Inter usa credenciais e certificado/chaves fornecidos pela conta PJ.

## Segurança

Nunca coloque estes valores no GitHub:

BOT_TOKEN
MP_ACCESS_TOKEN
MP_WEBHOOK_SECRET
CHECKOUT_SECRET

Use Environment Variables no Render.

O sistema não entrega o produto apenas porque recebeu uma notificação.
Ele consulta o pagamento na API e exige status aprovado e valor exato.

## Observação

Credenciais de cobrança devem pertencer a uma conta autorizada a usar o serviço, respeitando as regras e requisitos do provedor.
