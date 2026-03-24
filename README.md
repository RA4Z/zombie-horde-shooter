# Estrutura do Projeto — Zombies Multiplayer Isométrico

## Árvore de arquivos

```
public/
└── heartbeatWorker.js          ← Worker que mantém ticks em background

src/
├── main.tsx                    ← Entrada React
├── App.tsx                     ← Root: HUD + MainMenuUI + <PhaserGame>
├── App.css                     ← Estilos globais (BUG DO SELETOR CORRIGIDO)
├── PhaserGame.tsx              ← Wrapper React → Phaser
│
└── game/
    ├── EventBus.ts             ← Canal React ↔ Phaser
    ├── main.ts                 ← Configuração e inicialização do Phaser
    │
    ├── scenes/
    │   ├── Boot.ts             ← Carrega assets mínimos
    │   ├── Preloader.ts        ← Barra de progresso + carrega assets do jogo
    │   ├── MainMenu.ts         ← Cena Phaser (menu visual fica no React)
    │   ├── Game.ts             ← Cena principal ★
    │   └── GameOver.ts         ← Tela de fim de jogo
    │
    ├── entities/
    │   ├── Player.ts           ← Container isométrico (local e remoto)
    │   └── ZombieManager.ts    ← Spawn / remoção / IA / interpolação
    │
    ├── network/
    │   └── Multiplayer.ts      ← Serviço P2P (PeerJS)
    │
    └── utils/
        └── IsoMath.ts          ← cartesianToIso / isoToCartesian
```

---

## Arquivos do projeto original que NÃO existem mais

| Arquivo original          | Motivo                                                      |
|---------------------------|-------------------------------------------------------------|
| `src/game/scenes/World.ts`| Estava **vazio** — descartado                               |

Todos os outros arquivos foram reorganizados e renomeados conforme a árvore acima.

---

## Bugs e problemas corrigidos

### App.css — seletor inválido
```css
/* ANTES (inválido — "margin" não é um seletor HTML) */
margin, body, #root, #app { ... }

/* DEPOIS */
html, body, #root, #app { ... }
```

### Multiplayer.ts — JSON.parse no lugar errado
O `JSON.parse` estava em `Game.ts` dentro do handler de `network-data`,
misturando responsabilidades de serialização com lógica de jogo.
Movido para `Multiplayer.ts`, com tratamento de erro para dados malformados.

### Multiplayer.ts — sem cleanup de recursos
`peer.destroy()` nunca era chamado. Adicionado método `destroy()` que
fecha todas as conexões, limpa o intervalo de heartbeat e destrói o Peer.

### Game.ts — `removeAllListeners()` no EventBus
`EventBus.removeAllListeners()` em `shutdown()` era perigoso pois removeria
listeners de outras cenas. Substituído por remoção explícita dos listeners
registrados nesta cena.

### Game.ts — heartbeat duplicado
`initHeartbeatWorker()` e `startHostHeartbeat()` criavam dois Workers
concorrentes para o host. Unificado: um único Worker é criado no `create()`;
o host apenas muda o comportamento do tick via `this.isHost`.

### Game.ts — `handleRemoteMove` vs bloco inline em `setupNetworkEvents`
Havia dois caminhos para processar `move`: o método `handleRemoteMove()`
(que usava tween) e um bloco inline no switch (que setava posição diretamente).
Consolidado no método `handleRemoteMove()` com tween.

### ZombieManager.ts — spawn duplicado
Sem verificação de ID existente — o mesmo zumbi poderia ser spawnado duas
vezes em race conditions de rede. Adicionado guard `if (this.zombiesMap.has(id)) return`.

### ZombieManager.ts — cálculo de posição lógica inconsistente
`updateHost` calculava worldX/Y de forma incorreta a partir das coordenadas
isométricas. Agora o spawn salva a posição lógica em `setData` e a IA do
host usa esses valores diretamente.

### GameOver.ts — cena voltava para MainMenu sem resetar estado React
Adicionado `EventBus.emit('game-over')` para o React resetar HP/roomKey.

### main.ts — `arcade.debug: true` em produção
Corrigido para `false`.

---

## Fluxo da aplicação

```
React (App.tsx)
  │  botão clicado
  ▼
EventBus.emit('start-game', { isHost, roomId? })
  │
  ▼
Game.ts (onStartGame)
  ├── isHost → multiplayer.hostGame() → EventBus.emit('room-joined', key)
  └── guest  → multiplayer.joinGame(hostID)
                  └── conexão aberta → EventBus.emit('room-joined', peer)
  │
  ▼
App.tsx recebe 'room-joined' → esconde menu, mostra HUD
```

---

## Como a Host Migration funciona

1. Cada cliente monitora `lastHostHeartbeat` (atualizado a cada mensagem do host)
2. Se passar `MIGRATION_THRESHOLD` (4s) sem heartbeat, elege-se o peer com
   menor ID alfabético entre os restantes
3. Esse peer chama `becomeHost()` e anuncia `host-migration-start` para os demais
4. Os outros clientes atualizam `hostID` e reiniciam o contador de heartbeat