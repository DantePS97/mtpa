import axios from "axios";

const api = axios.create({
    baseURL: "http://localhost:3000/api"
});

export default api;

import api from "../services/api";

const respuesta = await api.get("/test-db");

console.log(respuesta.data);