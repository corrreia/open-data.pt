import "@fontsource-variable/archivo/wdth.css";
import "./styles.css";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";

const root = document.getElementById("root");
if (root === null) throw new Error("the page has nowhere to put the site");
// Not in StrictMode: the map takes hold of its canvas once and for good, and a second mount would take it twice.
createRoot(root).render(<App />);
