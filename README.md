# SolShield

Una extensión de Chrome que mira lo que tu wallet va a firmar y te avisa si parece estafa. Antes de que toques "Confirmar".

Funciona con Phantom, Solflare, Backpack, Glow, Trust y Coin98.

![overlay bloqueando un drainer](screenshots/01-overlay-suspicious.png)

## Por qué hice esto

Llevo un año en Solana y ya he visto de todo. Un amigo perdió como mil quinientos dólares firmando un mensaje de "Sign in" en una página falsa de Magic Eden. El mensaje en realidad no era un login, era un permit para que un drainer le moviera todos los tokens. Otro firmó algo "para reclamar un airdrop" y al día siguiente no tenía SOL.

Existen Blockaid y Blowfish que hacen algo parecido y son buenos. El problema es que son cerrados, son pagos, y solo te enteras de cómo funcionan si firmás un contrato comercial con ellos. Yo quería algo donde pudiera ver cada regla y cada prompt. Algo que cualquiera pudiera correr en su propio servidor sin pedir permiso.

Así que lo armé.

## Qué hace exactamente

Cuando una página te pide firmar algo en tu wallet:

1. SolShield se mete entre la página y tu wallet, y agarra la solicitud antes de que tu wallet la vea.
2. Le pasa los bytes a Claude (sí, el de Anthropic) más 23 reglas escritas a mano que detectan patrones típicos de drainers.
3. Te muestra un cartel con el resultado en lenguaje normal: "esto es seguro", "ojo, esto huele raro", o "no firmes esto, te van a vaciar la wallet".
4. Vos decidís. Si decís que no, tu wallet ni se entera de que alguien intentó.

Se ve así cuando algo es sospechoso:

![overlay con verdict suspicious y explicación](screenshots/01-overlay-suspicious.png)

Si clickeás "REJECT", la transacción se cancela ahí mismo. Phantom o Solflare ni siquiera abren su popup pidiéndote confirmación:

![overlay después de rechazar](screenshots/02-overlay-rejected.png)

## Un ejemplo concreto para que se entienda

Imaginá que entrás a una página que parece Magic Eden pero en realidad es `magiceden-airdrop.fake`. Te pide que firmes un mensaje que dice algo así:

```
phishing.com wants you to sign in with your Solana account:

Welcome! Sign to verify ownership.
```

A primera vista parece un login normal. Pero ese mensaje, una vez firmado, le da al atacante una firma criptográfica que puede usar en otra página. Es lo que se llama "spoofed SIWS domain" — el mensaje dice ser de un dominio (`phishing.com`) pero la página que lo pide es otra (`magiceden-airdrop.fake`).

SolShield ve que el dominio del mensaje no coincide con dónde estás y lo marca como peligro nivel 90/100. Claude te explica en una frase:

> "Este mensaje dice ser de phishing.com pero te lo está pidiendo magiceden-airdrop.fake — un ataque clásico de suplantación de dominio. Si firmás, podrían usar tu identidad o vaciar tu wallet."

Y listo. Vos clickeás Reject y nunca pasó nada.

## Cómo se ve en magiceden de verdad

Esto es una sesión real con la extensión instalada, navegando a Magic Eden auténtico:

![magiceden con SolShield](screenshots/03-magiceden-blocked.png)

Cuando Magic Eden te pide firmar el SIWS para login (que es legítimo), SolShield revisa el mensaje, lo marca como `safe`, y no muestra nada. No te molesta cuando todo está bien. Si el mensaje en cambio tuviera un dominio raro o un patrón de permit con cantidades, ahí sí te frenaría.

## Y para cuando el wallet abre su popup gigante

Phantom abre una pestaña entera ocupando toda la pantalla cuando le pedís confirmar. Si nuestro cartel quedara escondido detrás, no servíamos para nada. Por eso SolShield abre TAMBIÉN una ventana del navegador separada, fuera del DOM de la página, para que la veas seguro:

![ventana popup de SolShield](screenshots/04-popup-window.png)

Esa ventana tiene un botón "VOLVER A LA PESTAÑA Y DECIDIR" que te lleva de vuelta donde está el overlay. Es defensa en cuatro capas: el cartel en la página, una notificación del sistema operativo, un punto rojo en el icono de la extensión, y esta ventana popup. Una de las cuatro siempre la ves, importa qué tan ocupado tengas Chrome.

## La página

`https://solshield.dev`

![landing](screenshots/05-landing.png)

## Cómo funciona por dentro

Tres pedazos:

**La extensión** (`apps/extension`)
Lo que se instala en Chrome. Tiene dos scripts que se inyectan en cada página: uno se mete entre tu wallet y la página para interceptar las llamadas, y otro se encarga de mostrar los carteles. Hecha con React + Plasmo.

**El servidor** (`apps/web`)
Una API en Next.js que recibe la transacción o el mensaje, le pasa 23 reglas determinísticas (cosas tipo "este programa está en lista negra" o "este mensaje contiene una URL sospechosa"), y si algo se ve raro, le pregunta a Claude para que explique en lenguaje natural qué pasa. Está corriendo en un servidor mío en Hetzner.

**Las reglas y los prompts** (`packages/core`, `packages/ai`)
Archivos de texto cualquiera puede leer en GitHub. Si te parece que falta una regla o el prompt de Claude se puede mejorar, mandá un PR. Nada está oculto.

## Por qué Claude

Probé varios modelos. Claude Haiku 4.5 me da respuestas claras y cortas en menos de un segundo, y cuesta como $0.001 por análisis. Cuando una transacción es muy ambigua, escala a Claude Opus 4.7 que es más lento pero analiza instrucción por instrucción.

Los créditos los pago yo. Por ahora cubrimos todo desde el servidor, no necesitas tu propia API key — instalas la extensión y listo. Si la cosa crece y se queda corto, ya veré. Si querés correrlo en tu propio servidor con tu key, también podés (`docker compose up`).

## Instalación

Por ahora no está en la Chrome Web Store (la voy a subir cuando esté más estable). Mientras tanto:

```bash
git clone https://github.com/ivaldepablo/solshield
cd solshield
pnpm install
pnpm -F @solshield/extension build
```

Después en Chrome:

1. Andá a `chrome://extensions`
2. Activá "Developer mode" arriba a la derecha
3. Click en "Load unpacked"
4. Seleccioná la carpeta `apps/extension/build/chrome-mv3-prod`

Ya deberías ver el icono de SolShield en la toolbar.

## Wallets que funcionan

Probadas con cuentas reales en Solana mainnet:

- Phantom
- Solflare
- Backpack
- Glow
- Trust
- Coin98

También funciona con cualquier wallet que implemente el estándar wallet-standard.

## Lo que falta

Cosas pendientes que voy haciendo cuando tengo tiempo:

- Subirla a la Chrome Web Store
- Detectar tokens clonados de Pump.fun (cuando un token gradúa, hay una ventana de minutos donde alguien puede crear uno con el mismo nombre en Raydium para confundir y cazar gente que compra rápido)
- Soporte para Firefox
- Mejor UX cuando Phantom abre su pestaña full-screen y te roba el foco
- Más reglas a medida que aparezcan drainers nuevos

Si tenés ideas, abrí un issue. Si encontrás un bypass — que SolShield no detecte algo malicioso que debería — eso es lo más útil que podés reportar.

## Contacto

- Mail: hi@solshield.dev
- GitHub: [@ivaldepablo](https://github.com/ivaldepablo)

## Licencia

MIT. Hacé lo que quieras con esto, fork it, mejoralo, vendelo. Solo no te hagas pasar por mí.
