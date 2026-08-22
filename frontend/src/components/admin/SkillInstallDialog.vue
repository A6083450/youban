<template>
  <a-modal
    :open="open"
    :title="t('admin.skills.install.title')"
    :footer="null"
    :mask-closable="!submitting"
    :closable="!submitting"
    width="560px"
    @cancel="emit('close')"
  >
    <form class="skill-install-form" @submit.prevent="submit">
      <fieldset class="skill-install-source">
        <legend class="field-label">{{ t('admin.skills.install.sourceLabel') }}</legend>
        <a-segmented
          v-model:value="source"
          :options="sourceOptions"
          block
          :disabled="submitting"
        />
      </fieldset>

      <div v-if="source === 'upload'" class="skill-install-fields">
        <label class="field-label" for="skill-zip-file">{{ t('admin.skills.install.zipLabel') }}</label>
        <input
          id="skill-zip-file"
          ref="fileInput"
          class="file-input"
          type="file"
          accept=".zip,application/zip"
          :disabled="submitting"
          @change="selectFile"
        >
        <p class="field-hint">{{ t('admin.skills.install.zipHint') }}</p>
      </div>

      <div v-else class="skill-install-fields">
        <label class="field-label" for="skill-git-url">{{ t('admin.skills.install.gitUrl') }}</label>
        <a-input
          id="skill-git-url"
          v-model:value="gitUrl"
          type="url"
          autocomplete="url"
          :placeholder="t('admin.skills.install.gitUrlPlaceholder')"
          :disabled="submitting"
        />
        <label class="field-label" for="skill-git-ref">{{ t('admin.skills.install.gitRef') }}</label>
        <a-input
          id="skill-git-ref"
          v-model:value="gitRef"
          :placeholder="t('admin.skills.install.optional')"
          :disabled="submitting"
        />
        <label class="field-label" for="skill-git-subdirectory">{{ t('admin.skills.install.gitSubdirectory') }}</label>
        <a-input
          id="skill-git-subdirectory"
          v-model:value="gitSubdirectory"
          :placeholder="t('admin.skills.install.optional')"
          :disabled="submitting"
        />
        <div class="credential-status" role="status">
          <SafetyCertificateOutlined aria-hidden="true" />
          <span>
            {{ capabilities.private_git_credentials_available
              ? t('admin.skills.install.credentialsAvailable')
              : t('admin.skills.install.credentialsUnavailable') }}
          </span>
        </div>
      </div>

      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <div class="skill-install-actions">
        <a-button :disabled="submitting" @click="emit('close')">
          {{ t('common.cancel') }}
        </a-button>
        <a-button type="primary" html-type="submit" :loading="submitting">
          <UploadOutlined v-if="source === 'upload'" aria-hidden="true" />
          <CloudDownloadOutlined v-else aria-hidden="true" />
          {{ t(source === 'upload' ? 'admin.skills.install.uploadAction' : 'admin.skills.install.gitAction') }}
        </a-button>
      </div>
      <div class="sr-status" aria-live="polite">{{ asyncStatus }}</div>
    </form>
  </a-modal>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { CloudDownloadOutlined, SafetyCertificateOutlined, UploadOutlined } from '@ant-design/icons-vue'
import {
  localizeAdminSkillError,
  skillInstallSources,
  validateGitInstallInput,
  validateZipSelection,
} from '@/admin/skill-management'
import { adminInstallGitSkill, adminUploadSkill, isAdminAuthError } from '@/services/api'
import type { AdminSkillCapabilities, AdminSkillDetail } from '@/types'

const props = defineProps<{
  open: boolean
  capabilities: AdminSkillCapabilities
  onUnauthorized: () => void
}>()

const emit = defineEmits<{
  close: []
  installed: [skill: AdminSkillDetail]
}>()

const { t } = useI18n()
const source = ref<'upload' | 'git'>('upload')
const file = ref<File | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
const gitUrl = ref('')
const gitRef = ref('')
const gitSubdirectory = ref('')
const submitting = ref(false)
const formError = ref('')
const asyncStatus = ref('')

const sourceOptions = computed(() => skillInstallSources(props.capabilities).map((item) => ({
  value: item,
  label: t(item === 'upload' ? 'admin.skills.install.uploadTab' : 'admin.skills.install.gitTab'),
})))

watch(() => props.capabilities.git_available, (available) => {
  if (!available && source.value === 'git') source.value = 'upload'
})

watch(source, () => {
  formError.value = ''
  asyncStatus.value = ''
})

const selectFile = (event: Event) => {
  const input = event.target as HTMLInputElement
  file.value = input.files?.item(0) ?? null
  formError.value = ''
}

const submit = async () => {
  if (submitting.value) return
  formError.value = ''
  asyncStatus.value = t('admin.skills.install.installing')

  if (source.value === 'upload') {
    const validation = validateZipSelection(file.value ? [file.value] : [])
    if (validation) {
      formError.value = t(`admin.skills.install.validation.${validation}`)
      asyncStatus.value = ''
      return
    }
  } else {
    const validation = validateGitInstallInput({
      repository_url: gitUrl.value,
      ref: gitRef.value,
      subdirectory: gitSubdirectory.value,
    })
    if (validation) {
      formError.value = t(`admin.skills.install.validation.${validation}`)
      asyncStatus.value = ''
      return
    }
  }

  submitting.value = true
  try {
    const response = source.value === 'upload'
      ? await adminUploadSkill(file.value as File)
      : await adminInstallGitSkill({
        repository_url: gitUrl.value,
        ref: gitRef.value,
        subdirectory: gitSubdirectory.value,
      })
    if (!response.skill.candidate_version) {
      formError.value = t('admin.skills.errors.fallback')
      asyncStatus.value = formError.value
      return
    }
    asyncStatus.value = t('admin.skills.install.success')
    file.value = null
    if (fileInput.value) fileInput.value.value = ''
    gitUrl.value = ''
    gitRef.value = ''
    gitSubdirectory.value = ''
    emit('installed', response.skill)
  } catch (error) {
    if (isAdminAuthError(error)) {
      props.onUnauthorized()
      return
    }
    formError.value = t(localizeAdminSkillError(error))
    asyncStatus.value = formError.value
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.skill-install-form,
.skill-install-fields {
  display: grid;
  gap: 12px;
}

.skill-install-source {
  display: grid;
  gap: 8px;
  margin-bottom: 20px;
  padding: 0;
  border: 0;
}

.field-label {
  color: #3d3229;
  font-size: 13px;
  font-weight: 650;
}

.file-input {
  min-height: 44px;
  width: 100%;
  padding: 9px;
  border: 1px solid #d9d4ce;
  border-radius: 6px;
  background: #fff;
}

.file-input:focus-visible {
  outline: 3px solid rgba(196, 96, 61, 0.42);
  outline-offset: 2px;
}

.field-hint,
.form-error {
  margin: 0;
  font-size: 12px;
}

.field-hint {
  color: #746b64;
}

.form-error {
  color: #b42318;
}

.credential-status {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 10px;
  border-left: 3px solid #718355;
  background: #f5f7f2;
  color: #4c5940;
  font-size: 12px;
}

.skill-install-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 24px;
}

.sr-status {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
}

@media (max-width: 480px) {
  .skill-install-fields :deep(.ant-input),
  .skill-install-actions :deep(.ant-btn) {
    min-height: 44px;
  }

  .skill-install-source :deep(.ant-segmented-item-label) {
    min-height: 44px;
    line-height: 44px;
  }
}
</style>
