// api.typesafe.ai はブラウザからの CORS を拒否するので、開発サーバで中継する
export default {
  server: { proxy: { "/v1": { target: "https://api.typesafe.ai", changeOrigin: true } } },
};
