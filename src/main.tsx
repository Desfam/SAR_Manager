import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

const originalFetch = window.fetch.bind(window);

window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
	const token = localStorage.getItem('authToken');
	const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
	const isApiRequest = requestUrl.includes('/api/');

	if (!token || !isApiRequest) {
		return originalFetch(input, init);
	}

	const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
	if (!headers.has('Authorization')) {
		headers.set('Authorization', `Bearer ${token}`);
	}

	return originalFetch(input, {
		...init,
		headers,
	});
};

createRoot(document.getElementById("root")!).render(<App />);
