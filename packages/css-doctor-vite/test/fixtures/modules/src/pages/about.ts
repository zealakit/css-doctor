import styles from "./about.module.css";

export function render(): string {
  const key = location.search.slice(1);
  return `<div class="${(styles as Record<string, string>)[key]}">about</div>`;
}
