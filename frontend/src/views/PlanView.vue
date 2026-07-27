<template>
  <Result :plan-id="id" :key="id" />
</template>

<script setup lang="ts">
import Result from './Result.vue'

defineProps<{ id: string }>()
</script>
