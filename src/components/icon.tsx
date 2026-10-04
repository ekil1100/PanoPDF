import { icon, type IconName } from '../icons';

// Only the bundled, static SVG strings may cross this HTML boundary.
// display: contents preserves the original SVG's flex-item geometry.
export function Icon(props: { name: IconName }) {
  return <span style={{ display: 'contents' }} innerHTML={icon(props.name)} />;
}
