# Contrato interno

Electron main controla dados, ações e APIs nativas. Renderer sem Node, isolado e
sandboxed. Somente `window.keyboardTracker` é exposto pelo preload. Sem servidor
HTTP, serviços externos, mocks ou dados fictícios em produção.

## Configuração

```js
{
  version: 1,
  settings: { layerShortcut: 'F8', pauseShortcut: 'CommandOrControl+Shift+F12', cooldownMs: 400 },
  layers: [{ id: 'layer-1', name: 'Camada 1', description: '', bindings: [
    { id: 'binding-1', key: 'A', name: 'Registrar mensagem', action: { type: 'log', message: 'Tecla {{key}} na {{layer}}' } }
  ] }]
}
```

Action HTTP: `{type:'http', method:'POST', url:'https://...', headers:{}, query:{}, body:'{"value":1}'}`.
Action arquivo: `{type:'file', directory:'', filename:'nota-{{timestamp}}.txt', content:'...', mode:'create'|'append'}`.
Directory vazio usa Documentos/Keyboard Tracker. Create não sobrescreve existente.
Log: `{type:'log', message:'...'}`. Templates: `{{key}}`, `{{layer}}`, `{{date}}`, `{{timestamp}}`.

## API preload (todos métodos async, exceto assinaturas)

- `getState()` → State.
- `saveConfig(config)` → State; valida e persiste, atualiza registros globais.
- `setEnabled(boolean)` → State; ativa/pausa motor.
- `setLayer(layerId)` → State.
- `setEditing(boolean)` → State; suspende teclas de ação durante edição.
- `runBinding(layerId, bindingId)` → State; teste manual executa ação real mesmo pausado.
- `setTracking(boolean)` → State.
- `chooseDirectory()` → string|null.
- `openDataDirectory()` → void.
- `exportConfig()` e `importConfig()` → State (cancelar preserva estado).
- `onState(callback)` → unsubscribe; recebe State inteiro.
- `onKey(callback)` → unsubscribe; `{code:'KeyA',key:'A',direction:'down'|'up',source:'global'}`.

```js
State = {
 config, activeLayerId, enabled: false, editing: false,
 platform: 'linux'|'darwin'|'win32', session: 'wayland'|'x11'|'native',
 paths: { data: '...', documents: '...', log: '...' },
 shortcuts: { registered: [], failed: [{key, message}] },
 tracking: { enabled: false, mode: 'off'|'starting'|'global'|'local', message: '' },
 events: [{id,time,kind:'action'|'system',status:'success'|'error'|'info',message,layer,key}]
}
```

Métodos rejeitam com Error e mensagem em português. Interface deve mostrar erro.
Config tem limites e IDs únicos; nomes e conteúdo renderizados como texto.
Histórico limitado a 100 entradas, sem corpo/headers HTTP nem teclas rastreadas.
Atalhos são globais e podem substituir a digitação enquanto ativos. Nada inicia
automaticamente. Após primeira ativação, o controle global de pausa permanece
para permitir retomar. Rastreio e execução de ações têm controles independentes.
