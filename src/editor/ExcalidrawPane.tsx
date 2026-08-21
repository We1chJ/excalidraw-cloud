import { Excalidraw, MainMenu, Footer } from '@excalidraw/excalidraw';
import type { AppState, BinaryFiles } from '@excalidraw/excalidraw/types';
import type { OrderedExcalidrawElement } from '@excalidraw/excalidraw/element/types';
import type { DocMeta, SceneData } from '../storage/types';
import { SyncIndicator } from './SyncIndicator';

interface Props {
  doc: DocMeta;
  scene: SceneData;
  onChange: (
    elements: readonly OrderedExcalidrawElement[],
    appState: AppState,
    files: BinaryFiles,
  ) => void;
  onNewDoc: () => void;
}

export function ExcalidrawPane({ doc, scene, onChange, onNewDoc }: Props) {
  return (
    <div className="canvas-pane">
      <Excalidraw
        // Remounting per document is deliberate: it hands Excalidraw a clean
        // initialData instead of threading updateScene + addFiles + resetScene
        // through a switch, and document switching is not hot enough for the
        // remount cost to matter.
        key={doc.id}
        initialData={{
          elements: scene.elements,
          appState: scene.appState,
          files: scene.files,
          scrollToContent: true,
        }}
        onChange={onChange}
        name={doc.title}
        // Excalidraw's embeddable elements inject third-party widget scripts
        // (platform.twitter.com/widgets.js, embed.reddit.com/widgets.js). Those
        // are remotely hosted code, which MV3 forbids outright -- the CSP would
        // block them at runtime and their presence risks a Web Store rejection.
        // Refusing every embed keeps that path dead.
        validateEmbeddable={false}
      >
        <MainMenu>
          <MainMenu.Item onSelect={onNewDoc}>New drawing</MainMenu.Item>
          <MainMenu.Separator />
          <MainMenu.DefaultItems.LoadScene />
          <MainMenu.DefaultItems.SaveAsImage />
          <MainMenu.DefaultItems.Export />
          <MainMenu.Separator />
          <MainMenu.DefaultItems.ClearCanvas />
          <MainMenu.DefaultItems.ToggleTheme />
          <MainMenu.DefaultItems.ChangeCanvasBackground />
        </MainMenu>
        <Footer>
          <SyncIndicator doc={doc} />
        </Footer>
      </Excalidraw>
    </div>
  );
}
