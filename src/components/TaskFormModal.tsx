import { useEffect, useState } from 'react';
import { Form, Input, Modal, Select, message } from 'antd';
import { createTask, fetchExecutors, updateTask } from '../lib/api';
import type { Executor, Task } from '../types';

interface Values {
  title: string;
  description?: string;
  object_id: string;
  assignee_id: string | null;
}

export function TaskFormModal({
  open,
  task,
  objects,
  lockedObjectId,
  userId,
  onClose,
  onSaved,
}: {
  open: boolean;
  task: Task | null;
  objects: { id: string; name: string }[];
  lockedObjectId?: string;
  userId: string;
  onClose: () => void;
  onSaved: (taskId?: string | null) => void;
}) {
  const [executors, setExecutors] = useState<Executor[]>([]);
  const [form] = Form.useForm<Values>();
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    void fetchExecutors().then(setExecutors);
    form.setFieldsValue(
      task
        ? { title: task.title, description: task.description, object_id: task.object_id, assignee_id: task.assignee_id }
        : { title: '', description: '', object_id: lockedObjectId ?? objects[0]?.id, assignee_id: null },
    );
  }, [open, task, lockedObjectId, objects, form]);

  const submit = async () => {
    const values = await form.validateFields();
    setSaving(true);
    const result = task
      ? await updateTask(task.id, {
          title: values.title,
          description: values.description ?? '',
          assignee_id: values.assignee_id ?? null,
        })
      : await createTask({
          title: values.title,
          description: values.description ?? '',
          // На карточке объекта поле скрыто, и в values его нет — берём из контекста страницы.
          object_id: lockedObjectId ?? values.object_id,
          assignee_id: values.assignee_id ?? null,
          author_id: userId,
        });
    setSaving(false);
    if (result.error) {
      message.error(result.error);
      return;
    }
    message.success(task ? 'Задача обновлена' : 'Задача создана');
    onClose();
    onSaved(result.id);
  };

  return (
    <Modal
      open={open}
      title={task ? 'Правка задачи' : 'Новая задача'}
      onCancel={onClose}
      onOk={() => void submit()}
      okText="Сохранить"
      cancelText="Отмена"
      confirmLoading={saving}
      destroyOnHidden
    >
      <Form form={form} layout="vertical">
        <Form.Item label="Название" name="title" rules={[{ required: true, message: 'Нужно название' }]}>
          <Input maxLength={200} placeholder="Проверить геометрию фундамента" />
        </Form.Item>
        <Form.Item label="Описание" name="description">
          <Input.TextArea rows={4} maxLength={4000} placeholder="Что сделать, до какого числа, какие есть особенности" />
        </Form.Item>
        {!task && !lockedObjectId && (
          <Form.Item label="Объект" name="object_id" rules={[{ required: true, message: 'Нужен объект' }]}>
            <Select
              options={objects.map((object) => ({ value: object.id, label: object.name }))}
              placeholder="Выберите объект"
            />
          </Form.Item>
        )}
        <Form.Item
          label="Исполнитель"
          name="assignee_id"
          extra="Можно оставить пустым: задача появится у постановщика, но исполнитель её не увидит, пока не назначен."
        >
          <Select
            allowClear
            placeholder="Назначить исполнителя"
            options={executors.map((executor) => ({ value: executor.id, label: executor.full_name }))}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
