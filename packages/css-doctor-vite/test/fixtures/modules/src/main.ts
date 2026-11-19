const routes: Record<string, () => Promise<{ render: () => string }>> = {
  home: () => import("./pages/home"),
  about: () => import("./pages/about"),
};
const key = location.hash.slice(1) || "home";
routes[key]?.().then((page) => {
  document.body.innerHTML = page.render();
});
