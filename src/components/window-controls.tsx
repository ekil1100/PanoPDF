import type { WindowAction } from '../contracts';
import { Icon } from './icon';
import { Button } from './ui/button';

/** App-drawn controls; all window operations remain in the Electron main process. */
export function WindowControls(props: { action(action: WindowAction): void }) {
  return (
    <div class="window-controls ui-group" aria-label="窗口控制">
      <Button
        id="closeWindow"
        variant="ghost"
        size="icon"
        class="traffic-light ui-bg-[#ff5f57] hover:ui-bg-[#ff5f57]"
        aria-label="关闭窗口"
        title="关闭窗口"
        onClick={() => props.action('close')}
      >
        <Icon name="close" />
      </Button>
      <Button
        id="minimizeWindow"
        variant="ghost"
        size="icon"
        class="traffic-light ui-bg-[#febc2e] hover:ui-bg-[#febc2e]"
        aria-label="最小化窗口"
        title="最小化窗口"
        onClick={() => props.action('minimize')}
      >
        <Icon name="minus" />
      </Button>
      <Button
        id="maximizeWindow"
        variant="ghost"
        size="icon"
        class="traffic-light ui-bg-[#28c840] hover:ui-bg-[#28c840]"
        aria-label="进入全屏"
        title="进入全屏（按住 Option 最大化）"
        onClick={(event) => props.action(event.altKey ? 'toggle-maximize' : 'toggle-fullscreen')}
      >
        <Icon name="maximize" />
      </Button>
    </div>
  );
}
