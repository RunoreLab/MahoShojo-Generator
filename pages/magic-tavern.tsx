import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async () => ({
  redirect: {
    destination: '/magic-tea-party',
    permanent: true,
  },
});

export default function MagicTavernRedirect() {
  return null;
}
